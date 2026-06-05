import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import pcmCaptureProcessorUrl from "./pcmCaptureProcessor.ts?worker&url";

export type MicrophoneCaptureStatus =
  | "idle"
  | "requesting"
  | "capturing"
  | "stopped"
  | "unsupported"
  | "error";

export interface CapturedAudioFrame {
  sampleRate: number;
  samples: Int16Array;
  level: number;
  frameIndex: number;
}

export interface MicrophoneCaptureState {
  status: MicrophoneCaptureStatus;
  supported: boolean;
  sampleRate: number;
  frameCount: number;
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface MicrophoneCaptureOptions {
  targetSampleRate?: number;
  onFrame?: (frame: CapturedAudioFrame) => void;
}

const DEFAULT_TARGET_SAMPLE_RATE = 16_000;

export class StreamingAudioResampler {
  private readonly sampleRatio: number;
  private buffer = new Float32Array();
  private bufferStart = 0;
  private nextOutputPosition = 0;

  constructor(
    readonly inputSampleRate: number,
    readonly targetSampleRate: number,
  ) {
    if (inputSampleRate <= 0 || targetSampleRate <= 0) {
      throw new Error("sample rates must be positive");
    }
    if (targetSampleRate > inputSampleRate) {
      throw new Error("targetSampleRate must not exceed inputSampleRate");
    }

    this.sampleRatio = inputSampleRate / targetSampleRate;
  }

  process(input: Float32Array) {
    if (input.length === 0) {
      return new Float32Array();
    }

    const combined = new Float32Array(this.buffer.length + input.length);
    combined.set(this.buffer);
    combined.set(input, this.buffer.length);
    this.buffer = combined;

    const lastAvailablePosition = this.bufferStart + this.buffer.length - 1;
    const output: number[] = [];

    while (this.nextOutputPosition <= lastAvailablePosition) {
      const leftPosition = Math.floor(this.nextOutputPosition);
      const fraction = this.nextOutputPosition - leftPosition;
      const leftIndex = leftPosition - this.bufferStart;
      const rightIndex = leftIndex + 1;

      if (fraction > Number.EPSILON && rightIndex >= this.buffer.length) {
        break;
      }

      const leftSample = this.buffer[leftIndex] ?? 0;
      const rightSample = this.buffer[rightIndex] ?? leftSample;
      output.push(leftSample + (rightSample - leftSample) * fraction);
      this.nextOutputPosition += this.sampleRatio;
    }

    const discardCount = Math.min(
      this.buffer.length,
      Math.max(0, Math.floor(this.nextOutputPosition) - this.bufferStart),
    );
    if (discardCount > 0) {
      this.buffer = this.buffer.slice(discardCount);
      this.bufferStart += discardCount;
    }

    return Float32Array.from(output);
  }
}

function isBrowserAudioSupported() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    )
  );
}

export function downsampleToTargetSampleRate(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
) {
  return new StreamingAudioResampler(
    inputSampleRate,
    targetSampleRate,
  ).process(input);
}

export function floatToPcm16(samples: Float32Array) {
  const pcm16 = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm16[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return pcm16;
}

function calculateLevel(samples: Int16Array) {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = (samples[index] ?? 0) / 0x7fff;
    sumSquares += normalized * normalized;
  }

  return Math.min(1, Math.sqrt(sumSquares / samples.length));
}

export function useMicrophoneCapture(
  options: MicrophoneCaptureOptions = {},
): MicrophoneCaptureState {
  const targetSampleRate = options.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;
  const onFrameRef = useRef(options.onFrame);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const resamplerRef = useRef<StreamingAudioResampler | null>(null);
  const frameCountRef = useRef(0);

  const [status, setStatus] = useState<MicrophoneCaptureStatus>("idle");
  const [sampleRate, setSampleRate] = useState(DEFAULT_TARGET_SAMPLE_RATE);
  const [frameCount, setFrameCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const supported = useMemo(() => isBrowserAudioSupported(), []);

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  const releaseResources = useCallback(async () => {
    const currentWorklet = workletNodeRef.current;
    const currentSource = sourceNodeRef.current;
    const currentGain = gainNodeRef.current;
    const currentContext = audioContextRef.current;
    const currentStream = mediaStreamRef.current;

    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    resamplerRef.current = null;

    currentWorklet?.disconnect();
    currentSource?.disconnect();
    currentGain?.disconnect();

    currentStream?.getTracks().forEach((track) => track.stop());

    if (currentContext && currentContext.state !== "closed") {
      await currentContext.close();
    }
  }, []);

  const stop = useCallback(async () => {
    await releaseResources();
    setStatus("stopped");
  }, [releaseResources]);

  const start = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      setError("Current browser does not support realtime audio capture.");
      return;
    }

    setStatus("requesting");
    setError(null);

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error("Current browser does not support AudioContext.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule(pcmCaptureProcessorUrl);

      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const workletNode = new AudioWorkletNode(audioContext, "lingoflow-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      workletNodeRef.current = workletNode;
      const gainNode = audioContext.createGain();
      gainNodeRef.current = gainNode;
      gainNode.gain.value = 0;

      workletNode.port.onmessage = (event: MessageEvent) => {
        const payload = event.data as
          | {
              type: "frame";
              sampleRate: number;
              samples: Float32Array;
            }
          | undefined;

        if (!payload || payload.type !== "frame") {
          return;
        }

        if (
          !resamplerRef.current ||
          resamplerRef.current.inputSampleRate !== payload.sampleRate ||
          resamplerRef.current.targetSampleRate !== targetSampleRate
        ) {
          resamplerRef.current = new StreamingAudioResampler(
            payload.sampleRate,
            targetSampleRate,
          );
        }

        const downsampled = resamplerRef.current.process(payload.samples);
        if (downsampled.length === 0) {
          return;
        }

        const pcm16 = floatToPcm16(downsampled);
        const nextLevel = calculateLevel(pcm16);
        const nextFrameCount = frameCountRef.current + 1;

        frameCountRef.current = nextFrameCount;
        setSampleRate(targetSampleRate);
        setFrameCount(nextFrameCount);
        setLevel(nextLevel);
        setStatus("capturing");

        onFrameRef.current?.({
          frameIndex: nextFrameCount,
          level: nextLevel,
          sampleRate: targetSampleRate,
          samples: pcm16,
        });
      };

      sourceNode.connect(workletNode);
      workletNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      frameCountRef.current = 0;
      resamplerRef.current = null;
      setSampleRate(targetSampleRate);
      setFrameCount(0);
      setLevel(0);
      setStatus("capturing");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Microphone capture could not be started.";
      await releaseResources();
      setError(message);
      setStatus("error");
    }
  }, [releaseResources, supported, targetSampleRate]);

  useEffect(() => {
    return () => {
      void releaseResources();
    };
  }, [releaseResources]);

  return {
    status,
    supported,
    sampleRate,
    frameCount,
    level,
    error,
    start,
    stop,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type MicrophoneCaptureState,
  useMicrophoneCapture,
} from "../audio/useMicrophoneCapture";
import {
  RealtimeASRClient,
  type RealtimeTermHit,
  type RealtimeSessionState,
  type TranscriptStatus,
} from "./client";

export type RealtimeASRStatus =
  | "idle"
  | "connecting"
  | "running"
  | "stopping"
  | "ended"
  | "error";

export interface RealtimeTranscriptSegment {
  id: string;
  text: string;
  status: TranscriptStatus;
  /** 纠错高亮：如果此 segment 被纠错过，这里存储纠正后的文字（用于渲染高亮） */
  correctedHighlight?: string;
}

export interface TranscriptCorrection {
  id: string;
  original: string;
  corrected: string;
  strategy: string;
  timestamp: number;
}

export interface RealtimeASRState {
  status: RealtimeASRStatus;
  segments: RealtimeTranscriptSegment[];
  semanticSegments: RealtimeTranscriptSegment[];
  translationSegments: RealtimeTranscriptSegment[];
  termHits: RealtimeTermHit[];
  microphone: MicrophoneCaptureState;
  error: string | null;
  hasStarted: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setSpeechPlaybackEnabled: (enabled: boolean) => void;
}

export interface RealtimeASROptions {
  onSpeechPlaybackStarted?: (payload: {
    text: string;
    sourceText: string;
  }) => void;
  onSpeechPlaybackAudio?: (payload: {
    text: string;
    sourceText: string;
    audio: string;
    format: string;
    sampleRate: number;
    voice: string;
    provider: string;
  }) => void;
  onSpeechPlaybackFinished?: (payload: {
    text: string;
    sourceText: string;
    provider?: string;
    chunks?: number;
  }) => void;
  onSpeechPlaybackFailed?: (payload: {
    text: string;
    sourceText: string;
    message: string;
  }) => void;
  onCorrection?: (correction: {
    original: string;
    corrected: string;
    strategy: string;
    originalTranslation?: string;
    corrections: Array<{
      source_term: string;
      target_term: string;
      original_fragment: string;
      edit_distance: number;
    }>;
  }) => void;
}

export function mergeTranscript(
  current: RealtimeTranscriptSegment[],
  transcript: { text: string; status: TranscriptStatus },
) {
  const finalCount = current.filter(
    (segment) => segment.status === "final",
  ).length;
  const withoutLivePartial =
    current.at(-1)?.status === "partial" ? current.slice(0, -1) : current;

  if (transcript.status === "partial") {
    return [
      ...withoutLivePartial,
      {
        id: "partial-live",
        text: transcript.text,
        status: "partial" as const,
      },
    ];
  }

  return [
    ...withoutLivePartial,
    {
      id: `final-${finalCount + 1}`,
      text: transcript.text,
      status: "final" as const,
    },
  ];
}

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser-${crypto.randomUUID()}`;
  }
  return `browser-${Date.now()}`;
}

export function useRealtimeASR(
  options: RealtimeASROptions = {},
): RealtimeASRState {
  const clientRef = useRef<RealtimeASRClient | null>(null);
  const [status, setStatus] = useState<RealtimeASRStatus>("idle");
  const [segments, setSegments] = useState<RealtimeTranscriptSegment[]>([]);
  const [semanticSegments, setSemanticSegments] = useState<
    RealtimeTranscriptSegment[]
  >([]);
  const [translationSegments, setTranslationSegments] = useState<
    RealtimeTranscriptSegment[]
  >([]);
  const [termHits, setTermHits] = useState<RealtimeTermHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<TranscriptCorrection[]>([]);
  const speechPlaybackEnabledRef = useRef(false);

  const handleFrame = useCallback(
    (frame: {
      samples: Int16Array;
      sampleRate: number;
    }) => {
      clientRef.current?.sendAudio(frame.samples, frame.sampleRate);
    },
    [],
  );
  const microphone = useMicrophoneCapture({ onFrame: handleFrame });

  const handleSessionState = useCallback((state: RealtimeSessionState) => {
    if (state === "active") {
      setStatus("running");
    } else if (state === "stopped") {
      setStatus("ended");
      clientRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "running") {
      return;
    }

    clientRef.current?.disconnect();
    setSegments([]);
    setSemanticSegments([]);
    setTranslationSegments([]);
    setTermHits([]);
    setError(null);
    setStatus("connecting");

    const client = new RealtimeASRClient({
      sessionId: createSessionId(),
      onTranscript: (transcript) => {
        setSegments((current) => mergeTranscript(current, transcript));
      },
      onSemanticUnit: (semanticUnit) => {
        setSemanticSegments((current) => mergeTranscript(current, semanticUnit));
      },
      onTranslation: (translation) => {
        setTranslationSegments((current) =>
          mergeTranscript(current, translation),
        );
        if (translation.status === "final") {
          setTermHits((current) => {
            if (translation.termHits.length === 0) {
              return current;
            }
            // 累积命中记录，按 sourceTerm+startIndex 去重
            const next = [...current];
            for (const hit of translation.termHits) {
              const key = `${hit.sourceTerm}-${hit.startIndex}`;
              if (!next.some((h) => `${h.sourceTerm}-${h.startIndex}` === key)) {
                next.push(hit);
              }
            }
            return next;
          });
        }
      },
      onSessionState: handleSessionState,
      onSpeechPlaybackStarted: options.onSpeechPlaybackStarted,
      onSpeechPlaybackAudio: options.onSpeechPlaybackAudio,
      onSpeechPlaybackFinished: options.onSpeechPlaybackFinished,
      onSpeechPlaybackFailed: options.onSpeechPlaybackFailed,
      onCorrection: (correction) => {
        const newCorrection: TranscriptCorrection = {
          id: `correction-${Date.now()}`,
          original: correction.original,
          corrected: correction.corrected,
          strategy: correction.strategy,
          timestamp: Date.now(),
        };
        setCorrections((current) => [...current, newCorrection]);

        // 原文纠错：只高亮术语部分（source_term），不高亮整句
        const highlightTerm =
          correction.corrections?.[0]?.source_term || correction.corrected;
        setSegments((currentSegments) =>
          currentSegments.map((segment) => {
            if (
              segment.status === "final" &&
              segment.text === correction.original
            ) {
              return {
                ...segment,
                text: correction.corrected,
                correctedHighlight: highlightTerm,
              };
            }
            return segment;
          }),
        );

      },
      onSpeechPlaybackState: () => {
        // The workspace currently keeps the browser speech toggle as the
        // visible control. Backend playback state is available for future UI
        // wiring, but we don't need to mirror it yet.
      },
      onError: (message) => {
        client.disconnect();
        clientRef.current = null;
        setError(message);
        setStatus("error");
        void microphone.stop();
      },
    });
    clientRef.current = client;

    try {
      client.setSpeechPlaybackEnabled(speechPlaybackEnabledRef.current);
      await client.connect();
      await microphone.start();
    } catch (caughtError) {
      client.disconnect();
      clientRef.current = null;
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Realtime ASR could not be started.",
      );
      setStatus("error");
    }
  }, [
    handleSessionState,
    microphone,
    options.onSpeechPlaybackAudio,
    options.onSpeechPlaybackFailed,
    options.onSpeechPlaybackFinished,
    options.onSpeechPlaybackStarted,
    status,
  ]);

  const stop = useCallback(async () => {
    if (!clientRef.current) {
      return;
    }

    setStatus("stopping");
    await microphone.stop();
    clientRef.current.stop(microphone.sampleRate);
  }, [microphone]);

  const setSpeechPlaybackEnabled = useCallback((enabled: boolean) => {
    speechPlaybackEnabledRef.current = enabled;
    clientRef.current?.setSpeechPlaybackEnabled(enabled);
  }, []);

  useEffect(() => {
    if (microphone.status !== "error" || status === "error") {
      return;
    }

    clientRef.current?.disconnect();
    clientRef.current = null;
    setError(microphone.error ?? "Microphone capture failed.");
    setStatus("error");
  }, [microphone.error, microphone.status, status]);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  return {
    status,
    segments,
    semanticSegments,
    translationSegments,
    termHits,
    corrections,
    microphone,
    error,
    hasStarted: status !== "idle",
    start,
    stop,
    setSpeechPlaybackEnabled,
  };
}

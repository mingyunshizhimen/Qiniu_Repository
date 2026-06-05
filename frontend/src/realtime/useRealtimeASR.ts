import { useCallback, useEffect, useRef, useState } from "react";

import {
  type MicrophoneCaptureState,
  useMicrophoneCapture,
} from "../audio/useMicrophoneCapture";
import {
  RealtimeASRClient,
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
}

export interface RealtimeASRState {
  status: RealtimeASRStatus;
  segments: RealtimeTranscriptSegment[];
  microphone: MicrophoneCaptureState;
  error: string | null;
  hasStarted: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
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

export function useRealtimeASR(): RealtimeASRState {
  const clientRef = useRef<RealtimeASRClient | null>(null);
  const [status, setStatus] = useState<RealtimeASRStatus>("idle");
  const [segments, setSegments] = useState<RealtimeTranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setStatus("connecting");

    const client = new RealtimeASRClient({
      sessionId: createSessionId(),
      onTranscript: (transcript) => {
        setSegments((current) => mergeTranscript(current, transcript));
      },
      onSessionState: handleSessionState,
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
  }, [handleSessionState, microphone, status]);

  const stop = useCallback(async () => {
    if (!clientRef.current) {
      return;
    }

    setStatus("stopping");
    await microphone.stop();
    clientRef.current.stop(microphone.sampleRate);
  }, [microphone]);

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
    microphone,
    error,
    hasStarted: status !== "idle",
    start,
    stop,
  };
}

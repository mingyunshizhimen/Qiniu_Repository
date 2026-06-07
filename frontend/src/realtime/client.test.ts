import { describe, expect, it, vi } from "vitest";

import {
  PcmChunkBuffer,
  RealtimeASRClient,
  pcm16ToBase64,
  type RealtimeSocket,
} from "./client";

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

describe("PCM transport helpers", () => {
  it("encodes signed PCM16 samples as little-endian Base64", () => {
    expect(pcm16ToBase64(Int16Array.from([0x1234, -2]))).toBe("NBL+/w==");
  });

  it("groups worklet output into fixed 100ms chunks", () => {
    const buffer = new PcmChunkBuffer(1_600);

    expect(buffer.push(Int16Array.from({ length: 1_000 }, () => 1))).toEqual([]);
    const chunks = buffer.push(Int16Array.from({ length: 1_000 }, () => 2));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1_600);
    expect(buffer.flush()).toHaveLength(400);
  });
});

describe("RealtimeASRClient", () => {
  it("forwards transcript, semantic, translation, and term hit events", async () => {
    const socket = new FakeSocket();
    const onTranscript = vi.fn();
    const onSemanticUnit = vi.fn();
    const onTranslation = vi.fn();
    const onSessionState = vi.fn();
    const client = new RealtimeASRClient({
      sessionId: "browser-test",
      createSocket: () => socket,
      onTranscript,
      onSemanticUnit,
      onTranslation,
      onSessionState,
    });

    const connected = client.connect();
    socket.open();

    socket.receive({
      version: "1.0",
      type: "session.state",
      session_id: "browser-test",
      trace_id: "start-trace",
      sequence: 1,
      timestamp: "2026-06-06T00:00:00Z",
      payload: { state: "active" },
    });
    await connected;

    client.sendAudio(Int16Array.from({ length: 1_600 }, () => 1), 16_000);

    socket.receive({
      version: "1.0",
      type: "transcript.partial",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 2,
      timestamp: "2026-06-06T00:00:01Z",
      payload: { text: "hello", source: "asr", provider: "dashscope" },
    });
    socket.receive({
      version: "1.0",
      type: "transcript.final",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 3,
      timestamp: "2026-06-06T00:00:02Z",
      payload: {
        text: "complete semantic unit.",
        source: "asr",
        provider: "dashscope",
      },
    });
    socket.receive({
      version: "1.0",
      type: "semantic_unit.final",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 4,
      timestamp: "2026-06-06T00:00:03Z",
      payload: {
        text: "complete semantic unit.",
        source: "semantic",
        provider: "heuristic",
      },
    });
    socket.receive({
      version: "1.0",
      type: "translation.final",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 5,
      timestamp: "2026-06-06T00:00:04Z",
      payload: {
        text: "this is a complete semantic unit.",
        source: "translation",
        provider: "dashscope",
        source_text: "complete semantic unit.",
        term_hits: [
          {
            source_term: "complete semantic unit",
            target_term: "complete semantic unit",
            start_index: 0,
          },
        ],
      },
    });

    expect(onTranscript).toHaveBeenNthCalledWith(1, {
      text: "hello",
      status: "partial",
    });
    expect(onTranscript).toHaveBeenNthCalledWith(2, {
      text: "complete semantic unit.",
      status: "final",
    });
    expect(onSemanticUnit).toHaveBeenNthCalledWith(1, {
      text: "complete semantic unit.",
      status: "final",
    });
    expect(onTranslation).toHaveBeenNthCalledWith(1, {
      text: "this is a complete semantic unit.",
      status: "final",
      termHits: [
        {
          sourceTerm: "complete semantic unit",
          targetTerm: "complete semantic unit",
          startIndex: 0,
        },
      ],
    });

    client.stop();
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "session.stop",
    });
  });

  it("sends speech playback state to the backend once the session is active", async () => {
    const socket = new FakeSocket();
    const client = new RealtimeASRClient({
      sessionId: "browser-test",
      createSocket: () => socket,
    });

    const connected = client.connect();
    socket.open();

    socket.receive({
      version: "1.0",
      type: "session.state",
      session_id: "browser-test",
      trace_id: "start-trace",
      sequence: 1,
      timestamp: "2026-06-06T00:00:00Z",
      payload: { state: "active" },
    });
    await connected;

    client.setSpeechPlaybackEnabled(true);

    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "speech.playback.set",
      payload: { enabled: true },
    });
  });

  it("forwards backend speech playback audio events", async () => {
    const socket = new FakeSocket();
    const onSpeechPlaybackStarted = vi.fn();
    const onSpeechPlaybackAudio = vi.fn();
    const onSpeechPlaybackFinished = vi.fn();
    const onSpeechPlaybackFailed = vi.fn();
    const client = new RealtimeASRClient({
      sessionId: "browser-test",
      createSocket: () => socket,
      onSpeechPlaybackStarted,
      onSpeechPlaybackAudio,
      onSpeechPlaybackFinished,
      onSpeechPlaybackFailed,
    });

    const connected = client.connect();
    socket.open();

    socket.receive({
      version: "1.0",
      type: "session.state",
      session_id: "browser-test",
      trace_id: "start-trace",
      sequence: 1,
      timestamp: "2026-06-06T00:00:00Z",
      payload: { state: "active" },
    });
    await connected;

    socket.receive({
      version: "1.0",
      type: "speech.playback.started",
      session_id: "browser-test",
      trace_id: "playback-trace",
      sequence: 2,
      timestamp: "2026-06-06T00:00:01Z",
      payload: { text: "hello", source_text: "hello" },
    });
    socket.receive({
      version: "1.0",
      type: "tts.audio.delta",
      session_id: "browser-test",
      trace_id: "playback-trace",
      sequence: 3,
      timestamp: "2026-06-06T00:00:02Z",
      payload: {
        text: "hello",
        source_text: "hello",
        audio: "AQID",
        format: "pcm",
        sample_rate: 24000,
        voice: "Cherry",
        provider: "dashscope",
      },
    });
    socket.receive({
      version: "1.0",
      type: "speech.playback.finished",
      session_id: "browser-test",
      trace_id: "playback-trace",
      sequence: 4,
      timestamp: "2026-06-06T00:00:03Z",
      payload: { text: "hello", source_text: "hello", provider: "dashscope" },
    });

    expect(onSpeechPlaybackStarted).toHaveBeenCalledWith({
      text: "hello",
      sourceText: "hello",
    });
    expect(onSpeechPlaybackAudio).toHaveBeenCalledWith({
      text: "hello",
      sourceText: "hello",
      audio: "AQID",
      format: "pcm",
      sampleRate: 24000,
      voice: "Cherry",
      provider: "dashscope",
    });
    expect(onSpeechPlaybackFinished).toHaveBeenCalledWith({
      text: "hello",
      sourceText: "hello",
      provider: "dashscope",
      chunks: undefined,
    });
    expect(onSpeechPlaybackFailed).not.toHaveBeenCalled();
  });
});

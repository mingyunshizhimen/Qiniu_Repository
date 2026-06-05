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
  it("starts a session, streams audio, receives transcripts, and stops", async () => {
    const socket = new FakeSocket();
    const onTranscript = vi.fn();
    const onTranslation = vi.fn();
    const onSessionState = vi.fn();
    const client = new RealtimeASRClient({
      sessionId: "browser-test",
      createSocket: () => socket,
      onTranscript,
      onTranslation,
      onSessionState,
    });

    const connected = client.connect();
    socket.open();

    expect(JSON.parse(socket.sent[0])).toEqual({
      version: "1.0",
      type: "session.start",
      sequence: 1,
      payload: {
        source_language: "zh-CN",
        target_language: "en-US",
      },
    });

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
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: "audio.append",
      sequence: 2,
      payload: {
        format: "pcm",
        sample_rate: 16_000,
      },
    });

    socket.receive({
      version: "1.0",
      type: "transcript.partial",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 2,
      timestamp: "2026-06-06T00:00:01Z",
      payload: { text: "你好", source: "asr", provider: "dashscope" },
    });
    socket.receive({
      version: "1.0",
      type: "transcript.final",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 3,
      timestamp: "2026-06-06T00:00:02Z",
      payload: { text: "你好，七牛云。", source: "asr", provider: "dashscope" },
    });
    socket.receive({
      version: "1.0",
      type: "translation.final",
      session_id: "browser-test",
      trace_id: "speech-trace",
      sequence: 4,
      timestamp: "2026-06-06T00:00:03Z",
      payload: {
        text: "Hello, Qiniu Cloud.",
        source: "translation",
        provider: "dashscope",
        source_text: "你好，七牛云。",
      },
    });

    expect(onTranscript).toHaveBeenNthCalledWith(1, {
      text: "你好",
      status: "partial",
    });
    expect(onTranscript).toHaveBeenNthCalledWith(2, {
      text: "你好，七牛云。",
      status: "final",
    });
    expect(onTranslation).toHaveBeenNthCalledWith(1, {
      text: "Hello, Qiniu Cloud.",
      status: "final",
    });

    client.stop();
    expect(JSON.parse(socket.sent[2])).toMatchObject({
      type: "session.stop",
      sequence: 3,
    });

    socket.receive({
      version: "1.0",
      type: "session.state",
      session_id: "browser-test",
      trace_id: "stop-trace",
      sequence: 5,
      timestamp: "2026-06-06T00:00:04Z",
      payload: { state: "stopped" },
    });

    expect(onSessionState).toHaveBeenLastCalledWith("stopped");
    expect(socket.readyState).toBe(3);
  });
});

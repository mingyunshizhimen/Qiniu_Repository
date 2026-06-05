export type RealtimeSessionState = "idle" | "active" | "paused" | "stopped";
export type TranscriptStatus = "partial" | "final";

export interface RealtimeSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

interface RealtimeServerEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface RealtimeASRClientOptions {
  sessionId: string;
  baseUrl?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  createSocket?: (url: string) => RealtimeSocket;
  onTranscript?: (transcript: {
    text: string;
    status: TranscriptStatus;
  }) => void;
  onSessionState?: (state: RealtimeSessionState) => void;
  onError?: (message: string) => void;
}

const OPEN_READY_STATE = 1;
const PCM_CHUNK_SAMPLES = 1_600;

export function pcm16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index] ?? 0, true);
  }

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return window.btoa(binary);
}

export class PcmChunkBuffer {
  private pending = new Int16Array();

  constructor(private readonly chunkSize: number) {
    if (chunkSize <= 0) {
      throw new Error("chunkSize must be positive");
    }
  }

  push(samples: Int16Array) {
    const combined = new Int16Array(this.pending.length + samples.length);
    combined.set(this.pending);
    combined.set(samples, this.pending.length);

    const chunks: Int16Array[] = [];
    let offset = 0;
    while (combined.length - offset >= this.chunkSize) {
      chunks.push(combined.slice(offset, offset + this.chunkSize));
      offset += this.chunkSize;
    }
    this.pending = combined.slice(offset);
    return chunks;
  }

  flush() {
    const remaining = this.pending;
    this.pending = new Int16Array();
    return remaining;
  }
}

function defaultRealtimeBaseUrl() {
  const configuredUrl = import.meta.env.VITE_REALTIME_WS_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:8000/api/v1/ws/sessions`;
}

export class RealtimeASRClient {
  private readonly options: Required<
    Pick<
      RealtimeASRClientOptions,
      "sourceLanguage" | "targetLanguage" | "createSocket"
    >
  > &
    RealtimeASRClientOptions;
  private readonly audioBuffer = new PcmChunkBuffer(PCM_CHUNK_SAMPLES);
  private socket: RealtimeSocket | null = null;
  private sequence = 0;
  private sessionActive = false;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;

  constructor(options: RealtimeASRClientOptions) {
    this.options = {
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      createSocket: (url) =>
        new WebSocket(url) as unknown as RealtimeSocket,
      ...options,
    };
  }

  connect() {
    if (this.socket) {
      return Promise.reject(new Error("Realtime ASR session already exists."));
    }

    const baseUrl = this.options.baseUrl ?? defaultRealtimeBaseUrl();
    const url = `${baseUrl.replace(/\/$/, "")}/${this.options.sessionId}`;
    const socket = this.options.createSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.sendCommand("session.start", {
        source_language: this.options.sourceLanguage,
        target_language: this.options.targetLanguage,
      });
    };
    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      this.fail("Realtime WebSocket connection failed.");
    };
    socket.onclose = () => {
      this.socket = null;
      this.sessionActive = false;
      if (this.connectReject) {
        this.connectReject(
          new Error("Realtime WebSocket closed before the session started."),
        );
        this.clearConnectPromise();
      }
    };

    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
  }

  sendAudio(samples: Int16Array, sampleRate: number) {
    if (!this.sessionActive) {
      return;
    }

    for (const chunk of this.audioBuffer.push(samples)) {
      this.sendAudioChunk(chunk, sampleRate);
    }
  }

  stop(sampleRate = 16_000) {
    if (!this.socket || this.socket.readyState !== OPEN_READY_STATE) {
      this.disconnect();
      return;
    }

    const remaining = this.audioBuffer.flush();
    if (remaining.length > 0 && this.sessionActive) {
      this.sendAudioChunk(remaining, sampleRate);
    }
    this.sendCommand("session.stop", {});
  }

  disconnect() {
    this.sessionActive = false;
    this.audioBuffer.flush();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.clearConnectPromise();
  }

  private handleMessage(rawMessage: string) {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(rawMessage) as RealtimeServerEvent;
    } catch {
      this.fail("Realtime server returned an invalid message.");
      return;
    }

    if (event.type === "session.state") {
      const state = event.payload.state;
      if (
        state === "idle" ||
        state === "active" ||
        state === "paused" ||
        state === "stopped"
      ) {
        this.sessionActive = state === "active";
        this.options.onSessionState?.(state);

        if (state === "active" && this.connectResolve) {
          this.connectResolve();
          this.clearConnectPromise();
        }
        if (state === "stopped") {
          this.disconnect();
        }
      }
      return;
    }

    if (
      event.type === "transcript.partial" ||
      event.type === "transcript.final"
    ) {
      const text = event.payload.text;
      if (typeof text === "string" && text.trim()) {
        this.options.onTranscript?.({
          text,
          status:
            event.type === "transcript.final" ? "final" : "partial",
        });
      }
      return;
    }

    if (event.type === "error") {
      const message = event.payload.message;
      this.fail(
        typeof message === "string" && message
          ? message
          : "Realtime ASR request failed.",
      );
    }
  }

  private sendAudioChunk(samples: Int16Array, sampleRate: number) {
    this.sendCommand("audio.append", {
      audio: pcm16ToBase64(samples),
      format: "pcm",
      sample_rate: sampleRate,
    });
  }

  private sendCommand(type: string, payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== OPEN_READY_STATE) {
      throw new Error("Realtime WebSocket is not open.");
    }

    this.sequence += 1;
    this.socket.send(
      JSON.stringify({
        version: "1.0",
        type,
        sequence: this.sequence,
        payload,
      }),
    );
  }

  private fail(message: string) {
    this.options.onError?.(message);
    if (this.connectReject) {
      this.connectReject(new Error(message));
      this.clearConnectPromise();
    }
  }

  private clearConnectPromise() {
    this.connectResolve = null;
    this.connectReject = null;
  }
}

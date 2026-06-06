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
  onTranslation?: (translation: {
    text: string;
    status: TranscriptStatus;
  }) => void;
  onSemanticUnit?: (semanticUnit: {
    text: string;
    status: TranscriptStatus;
  }) => void;
  onSpeechPlaybackState?: (enabled: boolean) => void;
  onSpeechPlaybackStarted?: (payload: {
    text: string;
    sourceText: string;
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
  onSpeechPlaybackAudio?: (payload: {
    text: string;
    sourceText: string;
    audio: string;
    format: string;
    sampleRate: number;
    voice: string;
    provider: string;
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
  private pendingSpeechPlaybackEnabled: boolean | null = null;
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

  setSpeechPlaybackEnabled(enabled: boolean) {
    this.pendingSpeechPlaybackEnabled = enabled;
    if (!this.socket || this.socket.readyState !== OPEN_READY_STATE) {
      return;
    }
    if (!this.sessionActive) {
      return;
    }
    this.sendCommand("speech.playback.set", { enabled });
    this.pendingSpeechPlaybackEnabled = null;
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

        if (state === "active") {
          this.flushPendingSpeechPlaybackSetting();
        }
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

    if (
      event.type === "translation.partial" ||
      event.type === "translation.final"
    ) {
      const text = event.payload.text;
      if (typeof text === "string" && text.trim()) {
        this.options.onTranslation?.({
          text,
          status:
            event.type === "translation.final" ? "final" : "partial",
        });
      }
      return;
    }

    if (event.type === "semantic_unit.final") {
      const text = event.payload.text;
      if (typeof text === "string" && text.trim()) {
        this.options.onSemanticUnit?.({
          text,
          status: "final",
        });
      }
      return;
    }

    if (event.type === "speech.playback.state") {
      const enabled = event.payload.enabled;
      if (typeof enabled === "boolean") {
        this.options.onSpeechPlaybackState?.(enabled);
      }
      return;
    }

    if (event.type === "speech.playback.started") {
      const text = event.payload.text;
      const sourceText = event.payload.source_text;
      if (typeof text === "string" && typeof sourceText === "string") {
        this.options.onSpeechPlaybackStarted?.({
          text,
          sourceText,
        });
      }
      return;
    }

    if (event.type === "tts.audio.delta") {
      const audio = event.payload.audio;
      const text = event.payload.text;
      const sourceText = event.payload.source_text;
      const format = event.payload.format;
      const sampleRate = event.payload.sample_rate;
      const voice = event.payload.voice;
      const provider = event.payload.provider;
      if (
        typeof audio === "string" &&
        typeof text === "string" &&
        typeof sourceText === "string" &&
        typeof format === "string" &&
        typeof sampleRate === "number" &&
        typeof voice === "string" &&
        typeof provider === "string"
      ) {
        this.options.onSpeechPlaybackAudio?.({
          audio,
          text,
          sourceText,
          format,
          sampleRate,
          voice,
          provider,
        });
      }
      return;
    }

    if (event.type === "speech.playback.finished") {
      const text = event.payload.text;
      const sourceText = event.payload.source_text;
      if (typeof text === "string" && typeof sourceText === "string") {
        this.options.onSpeechPlaybackFinished?.({
          text,
          sourceText,
          provider:
            typeof event.payload.provider === "string"
              ? event.payload.provider
              : undefined,
          chunks:
            typeof event.payload.chunks === "number"
              ? event.payload.chunks
              : undefined,
        });
      }
      return;
    }

    if (event.type === "speech.playback.failed") {
      const text = event.payload.text;
      const sourceText = event.payload.source_text;
      const message = event.payload.message;
      if (
        typeof text === "string" &&
        typeof sourceText === "string" &&
        typeof message === "string"
      ) {
        this.options.onSpeechPlaybackFailed?.({
          text,
          sourceText,
          message,
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

  private flushPendingSpeechPlaybackSetting() {
    if (this.pendingSpeechPlaybackEnabled === null) {
      return;
    }

    if (!this.socket || this.socket.readyState !== OPEN_READY_STATE) {
      return;
    }

    if (!this.sessionActive) {
      return;
    }

    const enabled = this.pendingSpeechPlaybackEnabled;
    this.pendingSpeechPlaybackEnabled = null;
    this.sendCommand("speech.playback.set", { enabled });
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

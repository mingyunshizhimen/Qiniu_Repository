import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlaybackQueue, useSpeechPlayback } from "./useSpeechPlayback";

class MockUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

let speakMock: ReturnType<typeof vi.fn>;
let cancelMock: ReturnType<typeof vi.fn>;
let getVoicesMock: ReturnType<typeof vi.fn>;

class MockAudioBufferSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn(() => {
    queueMicrotask(() => this.onended?.());
  });
  stop = vi.fn();
}

class MockAudioContext {
  state: AudioContextState = "running";
  destination = {};
  resume = vi.fn(async () => undefined);
  createBuffer = vi.fn(
    (_channels: number, length: number, sampleRate: number) =>
      ({
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      }) as unknown as AudioBuffer,
  );
  createBufferSource = vi.fn(() => new MockAudioBufferSource());
}

describe("createPlaybackQueue", () => {
  it("queues only when enabled", () => {
    const queue = createPlaybackQueue();

    queue.enqueue("hello");
    expect(queue.size()).toBe(0);

    queue.setEnabled(true);
    queue.enqueue("hello");
    expect(queue.size()).toBe(1);

    queue.setEnabled(false);
    expect(queue.size()).toBe(0);
  });
});

describe("useSpeechPlayback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    speakMock = vi.fn((utterance: MockUtterance) => {
      queueMicrotask(() => utterance.onend?.());
    });
    cancelMock = vi.fn();
    getVoicesMock = vi.fn(() => [
      {
        default: true,
        lang: "en-US",
        localService: true,
        name: "Mock English",
        voiceURI: "mock-english",
      } as SpeechSynthesisVoice,
    ]);

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: speakMock,
        cancel: cancelMock,
        getVoices: getVoicesMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockUtterance,
    });
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
  });

  it("speaks queued text when enabled", async () => {
    const { result } = renderHook(() => useSpeechPlayback("en-US"));

    act(() => {
      result.current.setEnabled(true);
    });

    act(() => {
      result.current.enqueue("Hello world");
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledTimes(1);
    });

    const spoken = speakMock.mock.calls[0]?.[0] as MockUtterance;

    expect(spoken.text).toBe("Hello world");
    expect(spoken.lang).toBe("en-US");
    expect(cancelMock).toHaveBeenCalled();
  });

  it("plays backend audio when tts chunks are available", async () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });

    const { result } = renderHook(() => useSpeechPlayback("en-US"));

    act(() => {
      result.current.setEnabled(true);
    });

    act(() => {
      result.current.onSpeechPlaybackStarted({
        text: "Hello world",
        sourceText: "Hello world",
      });
      result.current.onSpeechPlaybackAudio({
        text: "Hello world",
        sourceText: "Hello world",
        audio: window.btoa(String.fromCharCode(1, 0, 2, 0)),
        format: "pcm",
        sampleRate: 24000,
        voice: "Cherry",
        provider: "dashscope",
      });
      result.current.onSpeechPlaybackFinished({
        text: "Hello world",
        sourceText: "Hello world",
        provider: "dashscope",
        chunks: 1,
      });
    });

    await waitFor(() => {
      expect(speakMock).not.toHaveBeenCalled();
    });
  });

  it("falls back to browser speech when backend emits no audio", async () => {
    const { result } = renderHook(() => useSpeechPlayback("en-US"));

    act(() => {
      result.current.setEnabled(true);
    });

    act(() => {
      result.current.onSpeechPlaybackStarted({
        text: "Fallback text",
        sourceText: "Fallback text",
      });
      result.current.onSpeechPlaybackFinished({
        text: "Fallback text",
        sourceText: "Fallback text",
        provider: "mock",
        chunks: 0,
      });
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to browser speech if backend audio stalls before chunks arrive", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useSpeechPlayback("en-US"));

    act(() => {
      result.current.setEnabled(true);
    });

    act(() => {
      result.current.onSpeechPlaybackStarted({
        text: "Delayed text",
        sourceText: "Delayed text",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export type SpeechPlaybackStatus =
  | "disabled"
  | "idle"
  | "speaking"
  | "unsupported"
  | "error";

export type SpeechPlaybackEngine = "browser" | "backend";

interface BackendSpeechJob {
  text: string;
  sourceText: string;
  audioChunks: string[];
  sampleRate: number;
  format: string;
  voice: string;
  provider: string;
  finished: boolean;
  failedMessage: string | null;
  fallbackTimerId: number | null;
}

const SPEECH_SYNTHESIS_TIMEOUT_MS = 15_000;
const BACKEND_AUDIO_FALLBACK_MS = 2_000;

function logSpeechPlayback(message: string, details?: Record<string, unknown>) {
  if (typeof console === "undefined") {
    return;
  }

  if (details) {
    console.warn(`[speech-playback] ${message}`, details);
    return;
  }

  console.warn(`[speech-playback] ${message}`);
}

export interface SpeechPlaybackQueue {
  setEnabled: (nextEnabled: boolean) => void;
  enqueue: (text: string) => void;
  dequeue: () => string | null;
  size: () => number;
  clear: () => void;
  isEnabled: () => boolean;
}

export interface SpeechPlaybackHandlers {
  onSpeechPlaybackStarted: (payload: {
    text: string;
    sourceText: string;
  }) => void;
  onSpeechPlaybackAudio: (payload: {
    text: string;
    sourceText: string;
    audio: string;
    format: string;
    sampleRate: number;
    voice: string;
    provider: string;
  }) => void;
  onSpeechPlaybackFinished: (payload: {
    text: string;
    sourceText: string;
    provider?: string;
    chunks?: number;
  }) => void;
  onSpeechPlaybackFailed: (payload: {
    text: string;
    sourceText: string;
    message: string;
  }) => void;
}

export function createPlaybackQueue(): SpeechPlaybackQueue {
  let enabled = false;
  const pending: string[] = [];

  return {
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) {
        pending.length = 0;
      }
    },
    enqueue(text: string) {
      const normalized = text.trim();
      if (!enabled || !normalized) {
        return;
      }
      pending.push(normalized);
    },
    dequeue() {
      return pending.shift() ?? null;
    },
    size() {
      return pending.length;
    },
    clear() {
      pending.length = 0;
    },
    isEnabled() {
      return enabled;
    },
  };
}

function supportsBrowserSpeechSynthesis() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function supportsAudioPlayback() {
  return (
    typeof window !== "undefined" &&
    ("AudioContext" in window || "webkitAudioContext" in window)
  );
}

function waitForVoices(timeoutMs: number) {
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (!supportsBrowserSpeechSynthesis()) {
      resolve([]);
      return;
    }

    const synthesis = window.speechSynthesis;
    const voices = synthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    const timer = window.setTimeout(() => {
      synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synthesis.getVoices());
    }, timeoutMs);

    const handleVoicesChanged = () => {
      window.clearTimeout(timer);
      synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synthesis.getVoices());
    };

    synthesis.addEventListener("voiceschanged", handleVoicesChanged, {
      once: true,
    });
  });
}

function pickVoice(language: string, voices: SpeechSynthesisVoice[]) {
  const normalizedLanguage = language.trim().toLowerCase();
  if (!normalizedLanguage || voices.length === 0) {
    return null;
  }

  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith(normalizedLanguage)) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

function speakText(text: string, language: string) {
  return new Promise<void>((resolve, reject) => {
    if (!supportsBrowserSpeechSynthesis()) {
      reject(new Error("Browser speech synthesis is not supported."));
      return;
    }

    void (async () => {
      const synthesis = window.speechSynthesis;
      synthesis.cancel();

      const voices = await waitForVoices(SPEECH_SYNTHESIS_TIMEOUT_MS);
      const utterance = new window.SpeechSynthesisUtterance(text);
      const voice = pickVoice(language, voices);
      utterance.lang = voice?.lang || language;
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      const timer = window.setTimeout(() => {
        synthesis.cancel();
        reject(new Error("Speech playback timed out."));
      }, SPEECH_SYNTHESIS_TIMEOUT_MS);

      utterance.onend = () => {
        window.clearTimeout(timer);
        resolve();
      };
      utterance.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Speech playback failed."));
      };
      synthesis.speak(utterance);
    })().catch((error: unknown) => {
      reject(
        error instanceof Error
          ? error
          : new Error("Speech playback failed."),
      );
    });
  });
}

function decodeBase64(base64Text: string) {
  const binary = window.atob(base64Text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatPcm16Chunks(chunks: string[]) {
  const decodedChunks = chunks.map((chunk) => decodeBase64(chunk));
  const totalBytes = decodedChunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );
  const totalSamples = Math.floor(totalBytes / 2);
  const samples = new Int16Array(totalSamples);
  let sampleOffset = 0;

  for (const chunk of decodedChunks) {
    const chunkSamples = new Int16Array(
      chunk.buffer,
      chunk.byteOffset,
      Math.floor(chunk.byteLength / 2),
    );
    samples.set(chunkSamples, sampleOffset);
    sampleOffset += chunkSamples.length;
  }

  return samples;
}

function int16ToFloat32(samples: Int16Array) {
  const floats = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    floats[index] = (samples[index] ?? 0) / 32768;
  }
  return floats;
}

async function ensureAudioContext(
  audioContextRef: MutableRefObject<AudioContext | null>,
) {
  if (!supportsAudioPlayback()) {
    return null;
  }

  const audioContextCtor =
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

  if (!audioContextCtor) {
    return null;
  }

  const audioContext = audioContextRef.current ?? new audioContextCtor();
  audioContextRef.current = audioContext;
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext;
}

export function useSpeechPlayback(language = "en-US") {
  const queueRef = useRef(createPlaybackQueue());
  const backendQueueRef = useRef<BackendSpeechJob[]>([]);
  const activeRef = useRef(false);
  const enabledRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [engine, setEngineState] = useState<SpeechPlaybackEngine>("browser");
  const [status, setStatus] = useState<SpeechPlaybackStatus>("disabled");
  const [queueSize, setQueueSize] = useState(0);
  const supported =
    engine === "backend"
      ? supportsAudioPlayback() || supportsBrowserSpeechSynthesis()
      : supportsBrowserSpeechSynthesis();

  const stopAudioPlayback = useCallback(() => {
    const source = audioSourceRef.current;
    audioSourceRef.current = null;
    try {
      source?.stop();
    } catch {
      // Ignore stop errors during teardown.
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (supportsBrowserSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
    stopAudioPlayback();
    activeRef.current = false;
  }, [stopAudioPlayback]);

  const clearBackendPlaybackTimers = useCallback(() => {
    for (const job of backendQueueRef.current) {
      if (job.fallbackTimerId !== null) {
        window.clearTimeout(job.fallbackTimerId);
        job.fallbackTimerId = null;
      }
    }
  }, []);

  const playBrowserSpeech = useCallback(
    (text: string) => {
      if (!supportsBrowserSpeechSynthesis()) {
        throw new Error("Browser speech synthesis is not supported.");
      }

      logSpeechPlayback("browser speech start", { text: text.slice(0, 120) });
      return speakText(text, language);
    },
    [language],
  );

  const playAudioJob = useCallback(async (job: BackendSpeechJob) => {
    if (!supportsAudioPlayback()) {
      throw new Error("Audio playback is not supported.");
    }

    const audioContextCtor =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!audioContextCtor) {
      throw new Error("Audio playback is not supported.");
    }

    logSpeechPlayback("backend audio start", {
      text: job.text.slice(0, 120),
      sourceText: job.sourceText.slice(0, 120),
      chunks: job.audioChunks.length,
      sampleRate: job.sampleRate,
      provider: job.provider,
    });

    const audioContext =
      audioContextRef.current ?? new audioContextCtor();
    audioContextRef.current = audioContext;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const samples = concatPcm16Chunks(job.audioChunks);
    const floatSamples = int16ToFloat32(samples);
    const buffer = audioContext.createBuffer(
      1,
      floatSamples.length,
      job.sampleRate > 0 ? job.sampleRate : 24000,
    );
    buffer.getChannelData(0).set(floatSamples);

    await new Promise<void>((resolve, reject) => {
      const source = audioContext.createBufferSource();
      audioSourceRef.current = source;
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (audioSourceRef.current === source) {
          audioSourceRef.current = null;
        }
        logSpeechPlayback("backend audio ended", {
          text: job.text.slice(0, 120),
          chunks: job.audioChunks.length,
        });
        resolve();
      };

      try {
        source.start();
      } catch (error) {
        if (audioSourceRef.current === source) {
          audioSourceRef.current = null;
        }
        reject(
          error instanceof Error
            ? error
            : new Error("Speech playback failed."),
        );
      }
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (activeRef.current || !enabledRef.current) {
      return;
    }

    if (!supported) {
      setStatus("unsupported");
      return;
    }

    activeRef.current = true;
    const playbackGeneration = playbackGenerationRef.current;
    let failed = false;

    try {
      while (enabledRef.current) {
        if (playbackGeneration !== playbackGenerationRef.current) {
          return;
        }

        const nextBackend = backendQueueRef.current[0];
        if (nextBackend && nextBackend.finished) {
          setStatus("speaking");
          logSpeechPlayback("processing backend queue item", {
            text: nextBackend.text.slice(0, 120),
            sourceText: nextBackend.sourceText.slice(0, 120),
            audioChunks: nextBackend.audioChunks.length,
            provider: nextBackend.provider,
          });
          try {
            if (nextBackend.audioChunks.length > 0) {
              await playAudioJob(nextBackend);
            } else {
              logSpeechPlayback("backend audio missing, falling back to browser speech", {
                text: nextBackend.text.slice(0, 120),
              });
              await playBrowserSpeech(nextBackend.text);
            }
          } catch {
            if (
              playbackGeneration !== playbackGenerationRef.current ||
              !enabledRef.current
            ) {
              return;
            }
            if (supportsBrowserSpeechSynthesis()) {
              logSpeechPlayback("backend audio failed, retrying with browser speech", {
                text: nextBackend.text.slice(0, 120),
              });
              await playBrowserSpeech(nextBackend.text);
            } else {
              throw new Error("Speech playback failed.");
            }
          } finally {
            backendQueueRef.current.shift();
            setQueueSize(
              queueRef.current.size() + backendQueueRef.current.length,
            );
          }
          continue;
        }

        const nextText = queueRef.current.dequeue();
        setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
        if (!nextText) {
          break;
        }

        setStatus("speaking");
        await playBrowserSpeech(nextText);
      }
    } catch {
      failed = true;
      setStatus(enabledRef.current ? "error" : "disabled");
      queueRef.current.clear();
      backendQueueRef.current.length = 0;
      setQueueSize(0);
      cancelSpeech();
      return;
    } finally {
      if (playbackGeneration === playbackGenerationRef.current) {
        activeRef.current = false;
      }
      if (failed) {
        setStatus(enabledRef.current ? "error" : "disabled");
      } else if (!enabledRef.current) {
        setStatus("disabled");
      } else if (
        queueRef.current.size() + backendQueueRef.current.length > 0
      ) {
        void processQueue();
      } else {
        setStatus("idle");
      }
    }
  }, [cancelSpeech, playAudioJob, playBrowserSpeech, supported]);

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      logSpeechPlayback("toggle changed", { enabled: nextEnabled });
      playbackGenerationRef.current += 1;
      enabledRef.current = nextEnabled;
      queueRef.current.setEnabled(nextEnabled);
      setEnabledState(nextEnabled);
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);

      if (!nextEnabled) {
        clearBackendPlaybackTimers();
        cancelSpeech();
        backendQueueRef.current.length = 0;
        setQueueSize(0);
        setStatus("disabled");
        return;
      }

      if (!supported) {
        setStatus("unsupported");
        return;
      }

      if (supportsAudioPlayback()) {
        void ensureAudioContext(audioContextRef).catch(() => {
          // If the browser refuses to unlock audio here, playback can still
          // fall back to browser speech synthesis or a later audio resume.
        });
      }

      setStatus("idle");
      void processQueue();
    },
    [cancelSpeech, processQueue, supported],
  );

  const setEngine = useCallback(
    (nextEngine: SpeechPlaybackEngine) => {
      setEngineState(nextEngine);
      playbackGenerationRef.current += 1;
      clearBackendPlaybackTimers();
      queueRef.current.clear();
      backendQueueRef.current.length = 0;
      setQueueSize(0);
      cancelSpeech();
      if (!enabledRef.current) {
        setStatus("disabled");
        return;
      }
      setStatus("idle");
      void processQueue();
    },
    [cancelSpeech, clearBackendPlaybackTimers, processQueue],
  );

  const enqueue = useCallback(
    (text: string) => {
      queueRef.current.enqueue(text);
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);

      if (enabledRef.current) {
        void processQueue();
      }
    },
    [processQueue],
  );

  const clear = useCallback(() => {
    playbackGenerationRef.current += 1;
    clearBackendPlaybackTimers();
    queueRef.current.clear();
    backendQueueRef.current.length = 0;
    setQueueSize(0);
    cancelSpeech();
    setStatus(enabledRef.current ? "idle" : "disabled");
  }, [cancelSpeech, clearBackendPlaybackTimers]);

  const onSpeechPlaybackStarted = useCallback(
    (payload: { text: string; sourceText: string }) => {
      if (!enabledRef.current) {
        return;
      }
      if (engine !== "backend") {
        return;
      }

      logSpeechPlayback("backend playback started", {
        text: payload.text.slice(0, 120),
        sourceText: payload.sourceText.slice(0, 120),
      });

      const backendJob: BackendSpeechJob = {
        text: payload.text.trim(),
        sourceText: payload.sourceText.trim(),
        audioChunks: [],
        sampleRate: 24000,
        format: "pcm",
        voice: "Cherry",
        provider: "mock",
        finished: false,
        failedMessage: null,
        fallbackTimerId: null,
      };

      backendJob.fallbackTimerId = window.setTimeout(() => {
        if (!enabledRef.current || backendJob.finished) {
          return;
        }

        if (backendJob.audioChunks.length > 0) {
          return;
        }

        backendJob.finished = true;
        backendJob.fallbackTimerId = null;
        setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
        void processQueue();
      }, BACKEND_AUDIO_FALLBACK_MS);

      backendQueueRef.current.push(backendJob);
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
    },
    [engine, processQueue],
  );

  const onSpeechPlaybackAudio = useCallback(
    (payload: {
      text: string;
      sourceText: string;
      audio: string;
      format: string;
      sampleRate: number;
      voice: string;
      provider: string;
    }) => {
      const job = [...backendQueueRef.current]
        .reverse()
        .find(
          (item) =>
            item.text === payload.text.trim() &&
            item.sourceText === payload.sourceText.trim() &&
            !item.finished,
        );

      if (!job) {
        return;
      }
      if (engine !== "backend") {
        return;
      }

      if (job.fallbackTimerId !== null) {
        window.clearTimeout(job.fallbackTimerId);
        job.fallbackTimerId = null;
      }

      logSpeechPlayback("backend playback audio chunk received", {
        text: payload.text.slice(0, 120),
        sourceText: payload.sourceText.slice(0, 120),
        size: payload.audio.length,
        format: payload.format,
        sampleRate: payload.sampleRate,
      });

      job.audioChunks.push(payload.audio);
      job.sampleRate = payload.sampleRate;
      job.format = payload.format;
      job.voice = payload.voice;
      job.provider = payload.provider;
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
    },
    [engine],
  );

  const onSpeechPlaybackFinished = useCallback(
    (payload: {
      text: string;
      sourceText: string;
      provider?: string;
      chunks?: number;
    }) => {
      const job = [...backendQueueRef.current]
        .reverse()
        .find(
          (item) =>
            item.text === payload.text.trim() &&
            item.sourceText === payload.sourceText.trim() &&
            !item.finished,
        );

      if (!job) {
        return;
      }
      if (engine !== "backend") {
        return;
      }

      if (job.fallbackTimerId !== null) {
        window.clearTimeout(job.fallbackTimerId);
        job.fallbackTimerId = null;
      }

      logSpeechPlayback("backend playback finished", {
        text: payload.text.slice(0, 120),
        sourceText: payload.sourceText.slice(0, 120),
        chunks: payload.chunks ?? job.audioChunks.length,
        provider: payload.provider ?? job.provider,
      });

      job.finished = true;
      if (payload.provider) {
        job.provider = payload.provider;
      }
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
      void processQueue();
    },
    [engine, processQueue],
  );

  const onSpeechPlaybackFailed = useCallback(
    (payload: { text: string; sourceText: string; message: string }) => {
      const job = [...backendQueueRef.current]
        .reverse()
        .find(
          (item) =>
            item.text === payload.text.trim() &&
            item.sourceText === payload.sourceText.trim() &&
            !item.finished,
        );

      if (!job) {
        return;
      }
      if (engine !== "backend") {
        return;
      }

      if (job.fallbackTimerId !== null) {
        window.clearTimeout(job.fallbackTimerId);
        job.fallbackTimerId = null;
      }

      logSpeechPlayback("backend playback failed", {
        text: payload.text.slice(0, 120),
        sourceText: payload.sourceText.slice(0, 120),
        message: payload.message,
      });

      job.finished = true;
      job.failedMessage = payload.message;
      setQueueSize(queueRef.current.size() + backendQueueRef.current.length);
      void processQueue();
    },
    [engine, processQueue],
  );

  useEffect(() => {
    return () => {
      playbackGenerationRef.current += 1;
      clearBackendPlaybackTimers();
      cancelSpeech();
      queueRef.current.clear();
      backendQueueRef.current.length = 0;
    };
  }, [cancelSpeech, clearBackendPlaybackTimers]);

  return {
    enabled,
    engine,
    setEnabled,
    setEngine,
    enqueue,
    clear,
    status,
    queueSize,
    supported,
    onSpeechPlaybackStarted,
    onSpeechPlaybackAudio,
    onSpeechPlaybackFinished,
    onSpeechPlaybackFailed,
  };
}

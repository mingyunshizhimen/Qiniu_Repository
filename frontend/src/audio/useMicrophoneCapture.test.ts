import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StreamingAudioResampler,
  downsampleToTargetSampleRate,
  floatToPcm16,
  useMicrophoneCapture,
} from "./useMicrophoneCapture";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser audio conversion", () => {
  it("downsamples a 48kHz frame to the corresponding 16kHz length", () => {
    const input = Float32Array.from({ length: 480 }, (_, index) => index / 480);

    const output = downsampleToTargetSampleRate(input, 48_000, 16_000);

    expect(output).toHaveLength(160);
  });

  it("preserves an exact 16kHz rate across 128-sample worklet frames", () => {
    const resampler = new StreamingAudioResampler(48_000, 16_000);
    let outputSamples = 0;

    for (let frameIndex = 0; frameIndex < 375; frameIndex += 1) {
      outputSamples += resampler.process(new Float32Array(128)).length;
    }

    expect(outputSamples).toBe(16_000);
  });

  it("clips Float32 samples and converts them to signed PCM16", () => {
    const output = floatToPcm16(
      Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]),
    );

    expect(Array.from(output)).toEqual([
      -32768,
      -32768,
      -16384,
      0,
      16383,
      32767,
      32767,
    ]);
  });
});

describe("microphone capture lifecycle", () => {
  it("keeps the error state when microphone permission is denied", async () => {
    vi.stubGlobal("AudioContext", class {});
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });

    const { result } = renderHook(() => useMicrophoneCapture());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Permission denied");
  });

  it("releases acquired audio resources when the worklet fails to load", async () => {
    const stopTrack = vi.fn();
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const addModule = vi.fn().mockRejectedValue(new Error("Worklet failed"));

    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        audioWorklet = { addModule };
        close = closeContext;
      },
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });

    const { result } = renderHook(() => useMicrophoneCapture());

    await act(async () => {
      await result.current.start();
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(closeContext).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Worklet failed");
  });
});

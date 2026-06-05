import { describe, expect, it } from "vitest";

import { mergeTranscript, type RealtimeTranscriptSegment } from "./useRealtimeASR";

describe("mergeTranscript", () => {
  it("replaces the live partial and preserves confirmed segments", () => {
    const firstPartial = mergeTranscript([], {
      text: "你好",
      status: "partial",
    });
    const updatedPartial = mergeTranscript(firstPartial, {
      text: "你好，七牛",
      status: "partial",
    });
    const confirmed = mergeTranscript(updatedPartial, {
      text: "你好，七牛云。",
      status: "final",
    });
    const nextPartial = mergeTranscript(confirmed, {
      text: "我们正在",
      status: "partial",
    });

    expect(nextPartial).toEqual<RealtimeTranscriptSegment[]>([
      {
        id: "final-1",
        text: "你好，七牛云。",
        status: "final",
      },
      {
        id: "partial-live",
        text: "我们正在",
        status: "partial",
      },
    ]);
  });
});

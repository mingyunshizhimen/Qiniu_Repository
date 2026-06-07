import { describe, expect, it } from "vitest";

import { mergeTranscript, type RealtimeTranscriptSegment } from "./useRealtimeASR";

describe("mergeTranscript", () => {
  it("replaces the live partial and preserves confirmed segments", () => {
    const firstPartial = mergeTranscript([], {
      text: "hello",
      status: "partial",
    });
    const updatedPartial = mergeTranscript(firstPartial, {
      text: "hello world",
      status: "partial",
    });
    const confirmed = mergeTranscript(updatedPartial, {
      text: "hello world.",
      status: "final",
    });
    const nextPartial = mergeTranscript(confirmed, {
      text: "we are",
      status: "partial",
    });

    expect(nextPartial).toEqual<RealtimeTranscriptSegment[]>([
      {
        id: "final-1",
        text: "hello world.",
        status: "final",
      },
      {
        id: "partial-live",
        text: "we are",
        status: "partial",
      },
    ]);
  });

  it("appends the next final without deleting confirmed history", () => {
    const firstFinal = mergeTranscript([], {
      text: "first sentence.",
      status: "final",
    });
    const liveSecond = mergeTranscript(firstFinal, {
      text: "second",
      status: "partial",
    });
    const secondFinal = mergeTranscript(liveSecond, {
      text: "second sentence.",
      status: "final",
    });

    expect(secondFinal).toEqual<RealtimeTranscriptSegment[]>([
      {
        id: "final-1",
        text: "first sentence.",
        status: "final",
      },
      {
        id: "final-2",
        text: "second sentence.",
        status: "final",
      },
    ]);
  });
});

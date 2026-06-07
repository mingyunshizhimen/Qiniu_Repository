import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRoutes } from "./App";

const { realtimeState } = vi.hoisted(() => ({
  realtimeState: {
    status: "idle",
    segments: [] as Array<{
      id: string;
      text: string;
      status: "partial" | "final";
    }>,
    semanticSegments: [] as Array<{
      id: string;
      text: string;
      status: "partial" | "final";
    }>,
    translationSegments: [] as Array<{
      id: string;
      text: string;
      status: "partial" | "final";
    }>,
    termHits: [] as Array<{
      sourceTerm: string;
      targetTerm: string;
      startIndex: number;
    }>,
    microphone: {
      status: "idle",
      supported: true,
      sampleRate: 16_000,
      frameCount: 0,
      level: 0,
      error: null as string | null,
      start: async () => {},
      stop: async () => {},
    },
    error: null as string | null,
    hasStarted: false,
    start: async () => {},
    stop: async () => {},
    setSpeechPlaybackEnabled: () => {},
  },
}));

vi.mock("./realtime/useRealtimeASR", () => ({
  useRealtimeASR: () => realtimeState,
}));

function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  realtimeState.status = "idle";
  realtimeState.segments = [];
  realtimeState.semanticSegments = [];
  realtimeState.translationSegments = [];
  realtimeState.termHits = [];
  realtimeState.error = null;
  realtimeState.hasStarted = false;
  realtimeState.microphone.status = "idle";
  realtimeState.microphone.frameCount = 0;
  realtimeState.microphone.level = 0;
  realtimeState.microphone.error = null;
});

describe("landing page", () => {
  it("shows the product message and entry point", () => {
    renderApp();

    expect(
      screen.getByRole("heading", { name: /让每一次交流，都自然抵达/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /进入快速同传/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("实时语音识别")).toBeInTheDocument();
    expect(screen.getByText("语义断句")).toBeInTheDocument();
    expect(screen.getByText("上下文翻译")).toBeInTheDocument();
    expect(screen.getByText("自然语音播报")).toBeInTheDocument();
  });

  it("opens the interpreter workspace", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: /进入快速同传/i }));

    expect(
      screen.getByRole("heading", { name: "实时同传工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mock 演示模式")).toBeInTheDocument();
  });
});

describe("workspace", () => {
  it("shows the speech playback switch and glossary summary entry", () => {
    renderApp("/interpreter");

    expect(
      screen.getByRole("switch", { name: "语音播报开关" }),
    ).toBeInTheDocument();
    expect(screen.getByText("语音播报")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "glossary summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "播报引擎" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open glossary workspace" }),
    ).toBeInTheDocument();
  });

  it("keeps subtitles visible when speech playback is toggled on unsupported browsers", async () => {
    const user = userEvent.setup();
    renderApp("/interpreter");

    await user.click(screen.getByRole("switch", { name: "语音播报开关" }));

    expect(screen.getByText("浏览器不支持")).toBeInTheDocument();
    expect(screen.getByText("语音播报")).toBeInTheDocument();
  });

  it("shows the microphone capture module", () => {
    renderApp("/interpreter");

    expect(
      screen.getByRole("region", { name: "browser audio capture" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start realtime ASR" }),
    ).toBeEnabled();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("shows live ASR, translations, and term hits when the session is active", () => {
    realtimeState.status = "running";
    realtimeState.hasStarted = true;
    realtimeState.segments = [
      {
        id: "final-1",
        text: "Complete semantic unit.",
        status: "final",
      },
    ];
    realtimeState.semanticSegments = [
      {
        id: "final-1",
        text: "Complete semantic unit.",
        status: "final",
      },
    ];
    realtimeState.translationSegments = [
      {
        id: "final-1",
        text: "这是一个完整的语义单元。",
        status: "final",
      },
    ];
    realtimeState.termHits = [
      {
        sourceTerm: "Complete semantic unit",
        targetTerm: "完整语义单元",
        startIndex: 0,
      },
    ];

    renderApp("/interpreter");

    expect(screen.getByText("Realtime ASR 模式")).toBeInTheDocument();
    expect(screen.getByText("Complete semantic unit.")).toBeInTheDocument();
    expect(screen.getByText("这是一个完整的语义单元。")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open glossary workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("完整语义单元")).toBeInTheDocument();
  });

  it("prompts the user to speak while realtime ASR awaits a semantic unit", () => {
    realtimeState.status = "running";
    realtimeState.hasStarted = true;

    renderApp("/interpreter");

    expect(
      screen.getByText("连接成功，等待完整语义单元。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("正在等待语义单元后生成译文。"),
    ).toBeInTheDocument();
  });

  it("starts and progressively shows mock subtitles", () => {
    vi.useFakeTimers();
    renderApp("/interpreter");

    fireEvent.click(screen.getByRole("button", { name: "开始演示" }));

    expect(screen.getByText("运行中")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText("欢迎使用语流同传")).toBeInTheDocument();
    expect(screen.getByText("正在识别")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(
      screen.getByText("欢迎使用语流同传，我们正在建立实时语音链路。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Welcome to LingoFlow. We are establishing the realtime voice link.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("已确认")).toBeInTheDocument();
  });
});


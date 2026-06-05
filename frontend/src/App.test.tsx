import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppRoutes } from "./App";


function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}


afterEach(() => {
  vi.useRealTimers();
});


describe("landing page", () => {
  it("shows the product message and only the available entry", () => {
    renderApp();

    expect(
      screen.getByRole("heading", { name: /让每一次交流，都自然抵达/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /进入快速同传/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("实时语音识别")).toBeInTheDocument();
    expect(screen.getByText("语义断句")).toBeInTheDocument();
    expect(screen.getByText("上下文翻译")).toBeInTheDocument();
    expect(screen.getByText("自然语音播报")).toBeInTheDocument();
    expect(screen.queryByText("同传记录")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 实验室")).not.toBeInTheDocument();
  });

  it("opens the interpreter workspace", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(
      screen.getByRole("link", { name: /进入快速同传/ }),
    );

    expect(
      screen.getByRole("heading", { name: "实时同传工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mock 演示模式")).toBeInTheDocument();
  });
});


describe("mock interpreter workspace", () => {
  it("shows the browser microphone capture module", () => {
    renderApp("/interpreter");

    expect(
      screen.getByRole("region", { name: "browser audio capture" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable microphone" }),
    ).toBeEnabled();
    expect(screen.getByText("Idle")).toBeInTheDocument();
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

  it("pauses, resumes, and ends the demo", () => {
    vi.useFakeTimers();
    renderApp("/interpreter");

    fireEvent.click(screen.getByRole("button", { name: "开始演示" }));
    act(() => {
      vi.advanceTimersByTime(900);
    });

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(screen.getByText("已暂停")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(
      screen.queryByText(
        "Welcome to LingoFlow. We are establishing the realtime voice link.",
      ),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByText("运行中")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(
      screen.getByText(
        "Welcome to LingoFlow. We are establishing the realtime voice link.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "结束" }));
    expect(screen.getByText("已结束")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新开始" }),
    ).toBeEnabled();
  });
});

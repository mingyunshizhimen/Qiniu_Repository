import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { MicrophoneCapturePanel } from "./components/MicrophoneCapturePanel";
import { useRealtimeASR } from "./realtime/useRealtimeASR";


export interface SubtitleSegment {
  id: string;
  sourceText: string;
  translatedText: string;
  status: "partial" | "final";
}

type SessionStatus = "idle" | "running" | "paused" | "ended";

const mockSteps: SubtitleSegment[] = [
  {
    id: "segment-1",
    sourceText: "欢迎使用语流同传",
    translatedText: "",
    status: "partial",
  },
  {
    id: "segment-1",
    sourceText: "欢迎使用语流同传，我们正在建立实时语音链路。",
    translatedText:
      "Welcome to LingoFlow. We are establishing the realtime voice link.",
    status: "final",
  },
  {
    id: "segment-2",
    sourceText: "语义断句会等待表达完整",
    translatedText: "",
    status: "partial",
  },
  {
    id: "segment-2",
    sourceText: "语义断句会等待表达完整，再交给上下文翻译模块。",
    translatedText:
      "Semantic segmentation waits for a complete thought before contextual translation.",
    status: "final",
  },
];

const capabilities = [
  {
    index: "01",
    title: "实时语音识别",
    description: "流式接收语音，区分临时与确认文本，为后续处理保留修订空间。",
  },
  {
    index: "02",
    title: "语义断句",
    description: "结合停顿、标点与完整度形成语义单元，减少翻译被生硬截断。",
  },
  {
    index: "03",
    title: "上下文翻译",
    description: "在会议上下文中保持术语和表达一致，避免逐句翻译造成语义漂移。",
  },
  {
    index: "04",
    title: "自然语音播报",
    description: "译文确认后进入异步播报队列，让字幕展示不被语音合成阻塞。",
  },
];


function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}


function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}


function AudioWave({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "audio-wave compact" : "audio-wave"}>
      {[10, 18, 28, 16, 34, 22, 12, 26, 18].map((height, index) => (
        <i key={`${height}-${index}`} style={{ height }} />
      ))}
    </span>
  );
}


function LandingPage() {
  return (
    <main className="landing-page">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="语流首页">
          <BrandMark />
          <span>
            <strong>语流</strong>
            <small>LINGOFLOW</small>
          </span>
        </Link>
        <span className="header-note">AI SIMULTANEOUS INTERPRETER</span>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">
            <span />
            面向真实交流的 AI 同声传译
          </div>
          <h1 aria-label="让每一次交流，都自然抵达">
            让每一次交流，
            <br />
            都<span>自然抵达</span>
          </h1>
          <p>
            从实时语音识别到语义断句、上下文翻译与自然播报，
            用一条稳定的智能管线，让专业表达跨越语言边界。
          </p>
          <div className="hero-actions">
            <Link
              className="primary-action"
              to="/interpreter"
              aria-label="进入快速同传"
            >
              进入快速同传
              <ArrowIcon />
            </Link>
            <span className="availability">
              <i />
              Mock 演示可直接运行
            </span>
          </div>
        </div>

        <div className="hero-visual" aria-label="实时字幕预览">
          <div className="visual-glow" />
          <div className="preview-window">
            <div className="preview-header">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>LIVE INTERPRETATION</span>
              <strong>
                <i />
                LIVE
              </strong>
            </div>
            <div className="preview-stage">
              <div className="language-row">
                <span>中文</span>
                <i />
                <span>English</span>
              </div>
              <div className="preview-line source">
                <small>原文</small>
                <p>好的想法，值得被每个人听见。</p>
              </div>
              <div className="preview-divider">
                <AudioWave compact />
              </div>
              <div className="preview-line target">
                <small>TRANSLATION</small>
                <p>Great ideas deserve to be heard by everyone.</p>
              </div>
            </div>
          </div>
          <div className="metric-card latency">
            <small>字幕状态</small>
            <strong>实时确认</strong>
          </div>
          <div className="metric-card context">
            <span>CONTEXT</span>
            <strong>上下文在线</strong>
          </div>
        </div>
      </section>

      <section className="capability-section">
        <div className="section-heading">
          <div>
            <small>ONE PIPELINE, CLEAR OUTCOME</small>
            <h2>不止翻译一句话</h2>
          </div>
          <p>每一个模块各司其职，又共享同一条实时事件流。</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((capability) => (
            <article key={capability.index} className="capability-card">
              <span>{capability.index}</span>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
              <i />
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}


function useMockInterpreter() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (status !== "running" || stepIndex >= mockSteps.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextSegment = mockSteps[stepIndex];
      setSegments((current) => {
        const existingIndex = current.findIndex(
          (segment) => segment.id === nextSegment.id,
        );
        if (existingIndex === -1) {
          return [...current, nextSegment];
        }
        return current.map((segment, index) =>
          index === existingIndex ? nextSegment : segment,
        );
      });
      setStepIndex((current) => current + 1);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [status, stepIndex]);

  const start = () => {
    if (status === "idle" || status === "ended") {
      setSegments([]);
      setStepIndex(0);
    }
    setStatus("running");
  };

  return {
    status,
    segments,
    start,
    pause: () => setStatus("paused"),
    resume: () => setStatus("running"),
    stop: () => setStatus("ended"),
  };
}


const statusLabels: Record<SessionStatus, string> = {
  idle: "待开始",
  running: "运行中",
  paused: "已暂停",
  ended: "已结束",
};


function TranscriptPanel({
  title,
  language,
  segments,
  translated,
  emptyMessage,
}: {
  title: string;
  language: string;
  segments: SubtitleSegment[];
  translated?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section className="transcript-panel">
      <header>
        <div>
          <small>{title}</small>
          <strong>{language}</strong>
        </div>
        {!translated && <AudioWave compact />}
      </header>
      <div className="transcript-content" aria-live="polite">
        {segments.length === 0 ? (
          <div className="empty-transcript">
            <span>{translated ? "TR" : "CN"}</span>
            <p>
              {emptyMessage ??
                (translated
                  ? "译文将在这里同步呈现"
                  : "点击开始，查看模拟字幕流")}
            </p>
          </div>
        ) : (
          segments.map((segment) => (
            <article
              className={`transcript-segment ${segment.status}`}
              key={segment.id}
            >
              <p>
                {translated
                  ? segment.translatedText || "等待确认原文后生成译文"
                  : segment.sourceText}
              </p>
              {!translated && (
                <span>
                  <i />
                  {segment.status === "partial" ? "正在识别" : "已确认"}
                </span>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}


function InterpreterPage() {
  const session = useMockInterpreter();
  const realtime = useRealtimeASR();
  const realtimeActive =
    realtime.status === "connecting" ||
    realtime.status === "running" ||
    realtime.status === "stopping";
  const showRealtime =
    realtime.hasStarted ||
    realtime.segments.length > 0 ||
    realtime.translationSegments.length > 0;
  const displayedSegments = showRealtime
    ? realtime.segments.map((segment) => ({
        id: segment.id,
        sourceText: segment.text,
        translatedText: "",
        status: segment.status,
      }))
    : session.segments;
  const displayedTranslationSegments = showRealtime
    ? realtime.translationSegments.map((segment) => ({
        id: segment.id,
        sourceText: "",
        translatedText: segment.text,
        status: segment.status,
      }))
    : session.segments;
  const displayedStatus: SessionStatus = realtimeActive
    ? "running"
    : realtime.status === "ended" || realtime.status === "error"
      ? "ended"
      : session.status;
  const isActive = session.status === "running" || session.status === "paused";
  const elapsed = useMemo(
    () => (displayedSegments.length ? "00:12" : "00:00"),
    [displayedSegments.length],
  );

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link className="brand workspace-brand" to="/" aria-label="返回首页">
          <BrandMark />
          <span>
            <strong>语流</strong>
            <small>LINGOFLOW</small>
          </span>
        </Link>
        <div className="workspace-title">
          <span>DEMO WORKSPACE</span>
          <h1>实时同传工作台</h1>
        </div>
        <div className="demo-badge">
          <i />
          {showRealtime ? "Realtime ASR 模式" : "Mock 演示模式"}
        </div>
      </header>

      <section className="session-bar">
        <div className="language-pair">
          <div>
            <small>SOURCE</small>
            <strong>中文</strong>
          </div>
          <span>
            <ArrowIcon />
          </span>
          <div>
            <small>TARGET</small>
            <strong>English</strong>
          </div>
        </div>
        <div className="session-meta">
          <div>
            <small>会话状态</small>
            <strong className={`status-${displayedStatus}`}>
              <i />
              {statusLabels[displayedStatus]}
            </strong>
          </div>
          <div>
            <small>已运行</small>
            <strong>{elapsed}</strong>
          </div>
        </div>
      </section>

      <section className="transcript-grid">
        <TranscriptPanel
          title="SOURCE TRANSCRIPT"
          language="原文字幕"
          segments={displayedSegments}
          emptyMessage={
            showRealtime ? "连接成功，请开始说话" : undefined
          }
        />
        <TranscriptPanel
          title="LIVE TRANSLATION"
          language="译文字幕"
          segments={displayedTranslationSegments}
          translated
          emptyMessage={
            showRealtime ? "正在等待确认原文后生成译文" : undefined
          }
        />
      </section>

      <section className="control-dock" aria-label="演示控制">
        <div className="dock-message">
          <span>
            <AudioWave compact />
          </span>
          <div>
            <small>当前数据源</small>
            <strong>
              {showRealtime
                ? "麦克风音频 · WebSocket 实时 ASR"
                : "预设事件流 · 无需麦克风权限"}
            </strong>
          </div>
        </div>
        <div className="control-buttons">
          {!isActive && (
            <button
              className="start-button"
              type="button"
              disabled={realtimeActive}
              onClick={session.start}
            >
              <span className="play-symbol" />
              {session.status === "ended" ? "重新开始" : "开始演示"}
            </button>
          )}
          {session.status === "running" && (
            <button className="secondary-button" type="button" onClick={session.pause}>
              <span className="pause-symbol" />
              暂停
            </button>
          )}
          {session.status === "paused" && (
            <button className="start-button" type="button" onClick={session.resume}>
              <span className="play-symbol" />
              继续
            </button>
          )}
          {isActive && (
            <button className="stop-button" type="button" onClick={session.stop}>
              <span />
              结束
            </button>
          )}
        </div>
      </section>

      <MicrophoneCapturePanel
        microphone={realtime.microphone}
        realtimeStatus={realtime.status}
        realtimeError={realtime.error}
        onStart={realtime.start}
        onStop={realtime.stop}
      />

      <p className="workspace-footnote">
        Realtime ASR 需要后端服务和 DASHSCOPE_API_KEY；Mock 演示仍可独立运行。
      </p>
    </main>
  );
}


export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/interpreter" element={<InterpreterPage />} />
    </Routes>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { MicrophoneCapturePanel } from "./components/MicrophoneCapturePanel";
import { GlossarySummaryPanel } from "./components/GlossarySummaryPanel";
import { useRealtimeASR } from "./realtime/useRealtimeASR";
import {
  type SpeechPlaybackEngine,
  type SpeechPlaybackStatus,
  useSpeechPlayback,
} from "./realtime/useSpeechPlayback";
import { GlossaryPage } from "./pages/GlossaryPage";

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
            <Link className="primary-action" to="/interpreter" aria-label="进入快速同传">
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
                <p>好的想法，值得被每一个人听见。</p>
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

function FlowTranscriptPanel({
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [followLatest, setFollowLatest] = useState(true);

  useEffect(() => {
    if (!followLatest || !contentRef.current) {
      return;
    }

    contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [followLatest, segments]);

  const handleScroll = () => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    setFollowLatest(distanceFromBottom < 24);
  };

  return (
    <section className="transcript-panel transcript-panel-flow">
      <header>
        <div>
          <small>{title}</small>
          <strong>{language}</strong>
        </div>
        <div className="transcript-panel-header-tools">
          {!translated && <AudioWave compact />}
          <span className={followLatest ? "follow-badge active" : "follow-badge"}>
            {followLatest ? "跟随最新" : "手动浏览"}
          </span>
        </div>
      </header>
      <div
        ref={contentRef}
        className="transcript-content transcript-flow"
        aria-live="polite"
        onScroll={handleScroll}
      >
        {segments.length === 0 ? (
          <div className="empty-transcript">
            <span>{translated ? "TR" : "CN"}</span>
            <p>
              {emptyMessage ??
                (translated
                  ? "译文将会在这里同步呈现"
                  : "点击开始，查看模拟字幕流")}
            </p>
          </div>
        ) : (
          <div className="transcript-flow-stream">
            {segments.map((segment, index) => (
              <span
                className={`transcript-flow-item ${segment.status}`}
                key={segment.id}
              >
                <span className="transcript-flow-text">
                  {translated
                    ? segment.translatedText || "等待确认原文后生成译文"
                    : segment.sourceText}
                </span>
                {!translated && (
                  <span className="transcript-flow-status">
                    <i />
                    {segment.status === "partial" ? "正在识别" : "已确认"}
                  </span>
                )}
                {index < segments.length - 1 && (
                  <span className="transcript-flow-gap" aria-hidden="true">
                    {" "}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InterpreterPage() {
  const session = useMockInterpreter();
  const {
    enabled: speechPlaybackEnabled,
    engine: speechPlaybackEngine,
    setEnabled: setSpeechPlaybackEnabled,
    setEngine: setSpeechPlaybackEngine,
    enqueue: enqueueSpeechPlayback,
    clear: clearSpeechPlayback,
    status: speechPlaybackStatus,
    queueSize: speechPlaybackQueueSize,
    supported: speechPlaybackSupported,
    onSpeechPlaybackStarted,
    onSpeechPlaybackAudio,
    onSpeechPlaybackFinished,
    onSpeechPlaybackFailed,
  } = useSpeechPlayback("en-US");
  const realtime = useRealtimeASR({
    onSpeechPlaybackStarted,
    onSpeechPlaybackAudio,
    onSpeechPlaybackFinished,
    onSpeechPlaybackFailed,
  });

  const realtimeActive =
    realtime.status === "connecting" ||
    realtime.status === "running" ||
    realtime.status === "stopping";
  const showRealtime =
    realtime.hasStarted ||
    realtime.segments.length > 0 ||
    realtime.semanticSegments.length > 0 ||
    realtime.translationSegments.length > 0;

  const displayedSourceSegments =
    showRealtime
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
  const lastBrowserPlaybackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (showRealtime) {
      return;
    }
    clearSpeechPlayback();
  }, [clearSpeechPlayback, showRealtime]);

  useEffect(() => {
    realtime.setSpeechPlaybackEnabled(
      speechPlaybackEnabled && speechPlaybackEngine === "backend",
    );
  }, [
    realtime.setSpeechPlaybackEnabled,
    speechPlaybackEnabled,
    speechPlaybackEngine,
  ]);

  useEffect(() => {
    if (!speechPlaybackEnabled || speechPlaybackEngine !== "browser") {
      lastBrowserPlaybackIdRef.current = null;
      return;
    }

    const latestFinal = [...realtime.translationSegments]
      .reverse()
      .find((segment) => segment.status === "final");

    if (!latestFinal) {
      return;
    }

    if (latestFinal.id === lastBrowserPlaybackIdRef.current) {
      return;
    }

    lastBrowserPlaybackIdRef.current = latestFinal.id;
    enqueueSpeechPlayback(latestFinal.text);
  }, [
    enqueueSpeechPlayback,
    realtime.translationSegments,
    speechPlaybackEnabled,
    speechPlaybackEngine,
  ]);

  const elapsed = useMemo(
    () => (displayedSourceSegments.length ? "00:12" : "00:00"),
    [displayedSourceSegments.length],
  );

  const playbackStatusLabels: Record<SpeechPlaybackStatus, string> = {
    disabled: "已关闭",
    idle: "待播报",
    speaking: "播报中",
    unsupported: "浏览器不支持",
    error: "播报失败",
  };

  const playbackEngineLabels: Record<SpeechPlaybackEngine, string> = {
    browser: "浏览器播报",
    backend: "后端高质量播报",
  };

  const sessionStatusLabels: Record<SessionStatus, string> = {
    idle: "待开始",
    running: "运行中",
    paused: "已暂停",
    ended: "已结束",
  };

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
              {sessionStatusLabels[displayedStatus]}
            </strong>
          </div>
          <div>
            <small>已运行</small>
            <strong>{elapsed}</strong>
          </div>
        </div>
      </section>

      <section className="speech-control" aria-label="语音播报控制">
        <div className="speech-control-copy">
          <small>语音播报</small>
          <strong>{speechPlaybackEnabled ? "已开启" : "已关闭"}</strong>
          <p>
            {!speechPlaybackSupported
              ? "当前模式在此浏览器中不可用，仅保留字幕显示。"
              : speechPlaybackEnabled
                ? "确认译文会进入播报队列，字幕显示不会被打断。"
                : "开启后，确认译文会被朗读；关闭时仅保留纯文本字幕。"}
          </p>
          <div className="speech-engine-copy">
            <strong>播报引擎：{playbackEngineLabels[speechPlaybackEngine]}</strong>
            <p>
              {speechPlaybackEngine === "browser"
                ? "推荐。主链路更轻，实时字幕更流畅，但音色和可控性相对一般。"
                : "音色更自然，更像正式产品；当前播报开始阶段可能短暂影响实时字幕质量，几秒后通常恢复。"}
            </p>
          </div>
        </div>
        <div className="speech-control-meta">
          <span className={`speech-status speech-status-${speechPlaybackStatus}`}>
            {playbackStatusLabels[speechPlaybackStatus]}
          </span>
          <span className="speech-queue">队列 {speechPlaybackQueueSize}</span>
          <label className="speech-engine-picker">
            <span>播报引擎</span>
            <select
              aria-label="播报引擎"
              value={speechPlaybackEngine}
              onChange={(event) =>
                setSpeechPlaybackEngine(
                  event.target.value as SpeechPlaybackEngine,
                )
              }
            >
              <option value="browser">浏览器播报（推荐）</option>
              <option value="backend">后端高质量播报</option>
            </select>
          </label>
          <button
            aria-checked={speechPlaybackEnabled}
            aria-label="语音播报开关"
            className={speechPlaybackEnabled ? "speech-switch active" : "speech-switch"}
            role="switch"
            type="button"
            onClick={() => setSpeechPlaybackEnabled(!speechPlaybackEnabled)}
          >
            <span />
          </button>
        </div>
      </section>
      <section className="transcript-grid">
        <FlowTranscriptPanel
          title="SOURCE TRANSCRIPT"
          language="原文字幕"
          segments={displayedSourceSegments}
          emptyMessage={showRealtime ? "连接成功，等待完整语义单元。" : undefined}
        />
        <FlowTranscriptPanel
          title="LIVE TRANSLATION"
          language="译文字幕"
          segments={displayedTranslationSegments}
          translated
          emptyMessage={showRealtime ? "正在等待语义单元后生成译文。" : undefined}
        />
      </section>

      <GlossarySummaryPanel termHits={realtime.termHits} />

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
      <Route path="/glossary" element={<GlossaryPage />} />
    </Routes>
  );
}


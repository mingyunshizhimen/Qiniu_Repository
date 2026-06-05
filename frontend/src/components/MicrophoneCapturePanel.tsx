import type { MicrophoneCaptureState } from "../audio/useMicrophoneCapture";
import type { RealtimeASRStatus } from "../realtime/useRealtimeASR";

interface MicrophoneCapturePanelProps {
  microphone: MicrophoneCaptureState;
  realtimeStatus: RealtimeASRStatus;
  realtimeError: string | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

const realtimeStatusLabels: Record<RealtimeASRStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  running: "Capturing",
  stopping: "Stopping",
  ended: "Stopped",
  error: "Error",
};

export function MicrophoneCapturePanel({
  microphone,
  realtimeStatus,
  realtimeError,
  onStart,
  onStop,
}: MicrophoneCapturePanelProps) {
  const realtimeActive =
    realtimeStatus === "connecting" ||
    realtimeStatus === "running" ||
    realtimeStatus === "stopping";
  const actionLabel =
    realtimeStatus === "running"
      ? "Stop realtime ASR"
      : realtimeStatus === "ended" || realtimeStatus === "error"
        ? "Restart realtime ASR"
        : "Start realtime ASR";
  const statusClass =
    realtimeStatus === "running"
      ? "capturing"
      : realtimeStatus === "connecting" || realtimeStatus === "stopping"
        ? "requesting"
        : realtimeStatus;
  const progressWidth = `${Math.max(8, Math.round(microphone.level * 100))}%`;
  const error = realtimeError ?? microphone.error;

  return (
    <section className="microphone-capture-panel" aria-label="browser audio capture">
      <header className="microphone-capture-header">
        <div>
          <small>05C / REALTIME ASR</small>
          <strong>Microphone to Live Transcript</strong>
        </div>
        <span className={`microphone-status microphone-status-${statusClass}`}>
          <i />
          {realtimeStatusLabels[realtimeStatus]}
        </span>
      </header>

      <p className="microphone-capture-copy">
        Captures 16kHz mono PCM audio, streams it to the backend over WebSocket,
        and displays realtime ASR transcripts above.
      </p>

      <div className="microphone-meter" aria-hidden="true">
        <span style={{ width: progressWidth }} />
      </div>

      <dl className="microphone-stats">
        <div>
          <dt>Sample rate</dt>
          <dd>{microphone.sampleRate.toLocaleString()} Hz</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd>{microphone.frameCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd>{Math.round(microphone.level * 100)}%</dd>
        </div>
      </dl>

      {error && (
        <p className="microphone-error" role="alert">
          {error}
        </p>
      )}

      <div className="microphone-actions">
        <button
          className="microphone-action"
          type="button"
          disabled={
            realtimeStatus === "connecting" ||
            realtimeStatus === "stopping" ||
            microphone.status === "requesting"
          }
          onClick={() => {
            void (realtimeActive ? onStop() : onStart());
          }}
        >
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

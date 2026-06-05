import { useMicrophoneCapture } from "../audio/useMicrophoneCapture";

const statusLabels = {
  idle: "Idle",
  requesting: "Requesting",
  capturing: "Capturing",
  stopped: "Stopped",
  unsupported: "Unsupported",
  error: "Error",
} as const;

export function MicrophoneCapturePanel() {
  const microphone = useMicrophoneCapture();
  const actionLabel =
    microphone.status === "capturing"
      ? "Stop capture"
      : microphone.status === "stopped"
        ? "Retry microphone"
        : "Enable microphone";

  const progressWidth = `${Math.max(8, Math.round(microphone.level * 100))}%`;

  return (
    <section className="microphone-capture-panel" aria-label="browser audio capture">
      <header className="microphone-capture-header">
        <div>
          <small>05B / BROWSER AUDIO</small>
          <strong>Microphone Capture</strong>
        </div>
        <span className={`microphone-status microphone-status-${microphone.status}`}>
          <i />
          {statusLabels[microphone.status]}
        </span>
      </header>

      <p className="microphone-capture-copy">
        This stage only captures browser microphone audio and converts it to 16kHz mono PCM
        frames. It does not send audio to the backend yet.
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

      {microphone.error && (
        <p className="microphone-error" role="alert">
          {microphone.error}
        </p>
      )}

      <div className="microphone-actions">
        <button
          className="microphone-action"
          type="button"
          onClick={() => {
            void (microphone.status === "capturing" ? microphone.stop() : microphone.start());
          }}
        >
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

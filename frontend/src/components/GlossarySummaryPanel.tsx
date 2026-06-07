import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import type { RealtimeTermHit } from "../realtime/client";
import type { TranscriptCorrection } from "../realtime/useRealtimeASR";

interface GlossarySummaryPanelProps {
  termHits: RealtimeTermHit[];
  corrections?: TranscriptCorrection[];
}

export function GlossarySummaryPanel({ termHits, corrections = [] }: GlossarySummaryPanelProps) {
  const visibleHits = termHits;
  const [flashKey, setFlashKey] = useState(0);

  // 每次有新纠错时触发闪烁动画
  useEffect(() => {
    if (corrections.length > 0) {
      setFlashKey((k) => k + 1);
      // 3秒后自动消失提示
      const timer = setTimeout(() => setFlashKey((k) => k + 1), 3000);
      return () => clearTimeout(timer);
    }
  }, [corrections.length]);

  const latestCorrection = corrections.length > 0 ? corrections[corrections.length - 1] : null;

  return (
    <section className="glossary-summary-panel" aria-label="glossary summary">
      <header className="glossary-summary-header">
        <div>
          <small>09C / TERMINOLOGY CENTER</small>
          <strong>Glossary workspace</strong>
        </div>
        <span className="glossary-metric">
          Hits {termHits.length}
        </span>
      </header>

      {/* 纠错通知 — 放在面板内部右侧区域 */}
      {latestCorrection && (
        <div className={`correction-inside-panel ${flashKey % 2 === 0 ? "correction-flash" : ""}`} key={flashKey}>
          <span className="correction-icon">✓</span>
          <div className="correction-detail">
            <strong>已自动纠正 {corrections.length} 处</strong>
            <span className="correction-diff">
              "{latestCorrection.original}" → "<em>{latestCorrection.corrected}</em>"
            </span>
          </div>
        </div>
      )}

      <p className="glossary-summary-copy">
        Keep the live interpreter focused on subtitles while managing glossary
        libraries on a dedicated page.
      </p>

      <div className="glossary-summary-body">
        {visibleHits.length === 0 && corrections.length === 0 ? (
          <p className="glossary-empty">
            No glossary hits yet. They will appear here when realtime translation
            matches the active glossary.
          </p>
        ) : (
          <div className="glossary-summary-hits">
            {visibleHits.map((hit) => (
              <article
                key={`${hit.sourceTerm}-${hit.startIndex}`}
                className="glossary-summary-hit"
              >
                <strong>{hit.sourceTerm}</strong>
                <span>{hit.targetTerm}</span>
              </article>
            ))}
          </div>
        )}

        <Link className="glossary-summary-action" to="/glossary">
          Open glossary workspace
        </Link>
      </div>
    </section>
  );
}

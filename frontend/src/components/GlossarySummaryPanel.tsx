import { Link } from "react-router-dom";

import type { RealtimeTermHit } from "../realtime/client";

interface GlossarySummaryPanelProps {
  termHits: RealtimeTermHit[];
}

export function GlossarySummaryPanel({ termHits }: GlossarySummaryPanelProps) {
  const visibleHits = termHits;

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

      <p className="glossary-summary-copy">
        Keep the live interpreter focused on subtitles while managing glossary
        libraries on a dedicated page.
      </p>

      <div className="glossary-summary-body">
        {visibleHits.length === 0 ? (
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

import { useEffect, useMemo, useState } from "react";

export interface GlossaryHit {
  sourceTerm: string;
  targetTerm: string;
  startIndex: number;
}

interface GlossaryTermRecord {
  id: string;
  source_term: string;
  target_term: string;
  description: string;
  enabled: boolean;
}

interface GlossaryPanelProps {
  termHits: GlossaryHit[];
}

export function GlossaryPanel({ termHits }: GlossaryPanelProps) {
  const [terms, setTerms] = useState<GlossaryTermRecord[]>([]);
  const [sourceTerm, setSourceTerm] = useState("");
  const [targetTerm, setTargetTerm] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTerms();
  }, []);

  const enabledCount = useMemo(
    () => terms.filter((term) => term.enabled).length,
    [terms],
  );

  async function loadTerms() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/glossary/terms");
      if (!response.ok) {
        throw new Error("Failed to load glossary terms.");
      }
      const payload = (await response.json()) as GlossaryTermRecord[];
      setTerms(payload);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load glossary terms.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTerm() {
    if (!sourceTerm.trim() || !targetTerm.trim()) {
      setError("Source term and target term are required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/glossary/terms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_term: sourceTerm,
          target_term: targetTerm,
          description,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to create glossary term.");
      }
      const created = (await response.json()) as GlossaryTermRecord;
      setTerms((current) => [...current, created]);
      setSourceTerm("");
      setTargetTerm("");
      setDescription("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to create glossary term.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleTerm(term: GlossaryTermRecord) {
    setError(null);
    try {
      const response = await fetch(`/api/v1/glossary/terms/${term.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !term.enabled,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update glossary term.");
      }
      const updated = (await response.json()) as GlossaryTermRecord;
      setTerms((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to update glossary term.",
      );
    }
  }

  async function handleDeleteTerm(term: GlossaryTermRecord) {
    setError(null);
    try {
      const response = await fetch(`/api/v1/glossary/terms/${term.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete glossary term.");
      }
      setTerms((current) => current.filter((item) => item.id !== term.id));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to delete glossary term.",
      );
    }
  }

  return (
    <section className="glossary-workspace" aria-label="glossary workspace">
      <article className="glossary-panel">
        <header className="glossary-panel-header">
          <div>
            <small>09C / TERMINOLOGY WORKSPACE</small>
            <strong>Glossary management</strong>
          </div>
          <span className="glossary-metric">
            Enabled {enabledCount} / Total {terms.length}
          </span>
        </header>

        <div className="glossary-form">
          <label>
            <span>Source term</span>
            <input
              aria-label="Source term"
              value={sourceTerm}
              onChange={(event) => setSourceTerm(event.target.value)}
              placeholder="例如：七牛云"
            />
          </label>
          <label>
            <span>Target term</span>
            <input
              aria-label="Target term"
              value={targetTerm}
              onChange={(event) => setTargetTerm(event.target.value)}
              placeholder="例如：Qiniu Cloud"
            />
          </label>
          <label className="glossary-form-wide">
            <span>Description</span>
            <input
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选说明"
            />
          </label>
          <button
            type="button"
            className="glossary-primary-action"
            disabled={submitting}
            onClick={() => {
              void handleCreateTerm();
            }}
          >
            Add term
          </button>
        </div>

        {error && (
          <p className="glossary-error" role="alert">
            {error}
          </p>
        )}

        <div className="glossary-list">
          {loading ? (
            <p className="glossary-empty">Loading glossary terms...</p>
          ) : terms.length === 0 ? (
            <p className="glossary-empty">
              No glossary terms yet. Add one to guide realtime translation.
            </p>
          ) : (
            terms.map((term) => (
              <article key={term.id} className="glossary-term-card">
                <div className="glossary-term-copy">
                  <strong>{term.source_term}</strong>
                  <span>{term.target_term}</span>
                  {term.description && <p>{term.description}</p>}
                </div>
                <div className="glossary-term-actions">
                  <button
                    type="button"
                    className={term.enabled ? "glossary-chip active" : "glossary-chip"}
                    aria-label={`${term.enabled ? "Disable" : "Enable"} term ${term.source_term}`}
                    onClick={() => {
                      void handleToggleTerm(term);
                    }}
                  >
                    {term.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    type="button"
                    className="glossary-delete"
                    aria-label={`Delete term ${term.source_term}`}
                    onClick={() => {
                      void handleDeleteTerm(term);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </article>

      <article className="glossary-panel glossary-panel-hits">
        <header className="glossary-panel-header">
          <div>
            <small>REALTIME TERM HITS</small>
            <strong>Current term hits</strong>
          </div>
          <span className="glossary-metric">Hits {termHits.length}</span>
        </header>

        <div className="glossary-hits">
          {termHits.length === 0 ? (
            <p className="glossary-empty">
              Matching terms will appear here when a translated segment hits the glossary.
            </p>
          ) : (
            termHits.map((hit) => (
              <article
                key={`${hit.sourceTerm}-${hit.startIndex}`}
                className="glossary-hit-card"
              >
                <strong>{hit.sourceTerm}</strong>
                <span>{hit.targetTerm}</span>
                <small>Index {hit.startIndex}</small>
              </article>
            ))
          )}
        </div>
      </article>
    </section>
  );
}

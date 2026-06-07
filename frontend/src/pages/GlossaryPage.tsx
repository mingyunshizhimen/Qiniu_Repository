import { Link } from "react-router-dom";

import { GlossaryPanel } from "../components/GlossaryPanel";

export function GlossaryPage() {
  return (
    <main className="glossary-page">
      <header className="glossary-page-header">
        <div>
          <small>09C / TERMINOLOGY WORKSPACE</small>
          <h1>Glossary library</h1>
        </div>
        <Link className="glossary-page-back" to="/interpreter">
          Back to interpreter
        </Link>
      </header>

      <section className="glossary-page-intro">
        <p>
          Manage the active glossary here. This page keeps the workspace light
          and leaves room for future multiple glossary libraries.
        </p>
      </section>

      <GlossaryPanel termHits={[]} />
    </main>
  );
}

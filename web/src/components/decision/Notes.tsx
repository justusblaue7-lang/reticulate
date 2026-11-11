import type { Notes as NotesData } from "../../types";

const STATUS = { open: "to test", holds: "holds", shaky: "shaky", dropped: "dropped" } as const;

/** The working notes: where the decision stands, in the person's own terms. */
export function Notes({ notes }: { notes: NotesData | null | undefined }) {
  if (!notes) {
    return (
      <aside className="notes empty">
        <h3 className="eyebrow">Working notes</h3>
        <p className="note">What you establish in the dialogue collects here: what matters to you, your options, what is still unknown.</p>
      </aside>
    );
  }
  const lean = notes.leaning.trim().toLowerCase();
  return (
    <aside className="notes">
      <h3 className="eyebrow">Working notes</h3>
      {notes.decision && <p className="notes-decision">{notes.decision}</p>}
      {notes.goals.length > 0 && (
        <section>
          <h4>What matters</h4>
          <ol className="goals">
            {notes.goals.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
        </section>
      )}
      {notes.options.length > 0 && (
        <section>
          <h4>Options</h4>
          <ul className="opts">
            {notes.options.map((o) => (
              <li key={o} className={lean && o.trim().toLowerCase() === lean ? "lean" : ""}>
                {o}
                {lean && o.trim().toLowerCase() === lean && <span className="lean-tag">leaning</span>}
              </li>
            ))}
          </ul>
          {notes.leaning && !notes.options.some((o) => o.trim().toLowerCase() === lean) && <p className="note">Leaning: {notes.leaning}</p>}
        </section>
      )}
      {notes.confidence >= 0 && (
        <section className="sure">
          <h4>How sure</h4>
          <span className="meter" aria-hidden>
            <span style={{ width: `${notes.confidence * 10}%` }} />
          </span>
          <span className="mono">{notes.confidence}/10</span>
        </section>
      )}
      {notes.unknowns.length > 0 && (
        <section>
          <h4>Still unknown</h4>
          <ul>
            {notes.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}
      {notes.assumptions.length > 0 && (
        <section>
          <h4>Assumptions</h4>
          <ul className="assumptions">
            {notes.assumptions.map((a) => (
              <li key={a.text} className={a.status}>
                <span className={`status ${a.status}`}>{STATUS[a.status]}</span>
                {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {notes.facts.length > 0 && (
        <details className="facts">
          <summary>Facts you gave ({notes.facts.length})</summary>
          <ul>
            {notes.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

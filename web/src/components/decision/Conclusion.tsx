import type { Decision, Science } from "../../types";

const LEVEL = { strong: "Strong", partial: "Partial", weak: "Weak" } as const;

interface Props {
  science: Science;
  decision: Decision;
  busy: boolean;
  onSettle: (items: string[]) => void;
  onReopen: () => void;
  onPanel: () => void;
  onReveal: () => void;
}

/** The decision as the person reached it: the choice, why, the first step, and what to settle. */
export function Conclusion({ science, decision, busy, onSettle, onReopen, onPanel, onReveal }: Props) {
  const c = decision.dialogue!.conclusion!;
  const settled = new Set(decision.settled);
  const stages = new Map(science.socratic.stages.map((s) => [s.id, s]));
  const weakest = c.quality.filter((q) => q.level === "weak");
  const toggle = (item: string) => onSettle(settled.has(item) ? decision.settled.filter((x) => x !== item) : [...decision.settled, item]);

  return (
    <section className="conclusion">
      <span className="eyebrow">{c.decided ? "Your decision" : "Where you stand"}</span>
      <h2 className="statement">{c.statement}</h2>
      {!c.decided && <p className="note">You have not settled on an option yet. The open questions below are what stands between you and the decision.</p>}

      <div className="conclusion-grid">
        {c.reasons.length > 0 && (
          <div>
            <h3 className="subhead">Why</h3>
            <ul>
              {c.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {c.tradeoffs.length > 0 && (
          <div>
            <h3 className="subhead">What you give up</h3>
            <ul>
              {c.tradeoffs.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {c.revisit_if.length > 0 && (
          <div>
            <h3 className="subhead">Look at it again if</h3>
            <ul>
              {c.revisit_if.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {c.first_step && (
        <div className="first-step">
          <span className="kicker">First step</span>
          <p className="step">{c.first_step}</p>
          {c.if_then && <p className="if-then">{c.if_then}</p>}
          {c.review && <p className="note">Review the decision {c.review.replace(/^review\s+/i, "")}.</p>}
        </div>
      )}

      {c.open_questions.length > 0 && (
        <div className="settle">
          <h3 className="subhead">Before you act</h3>
          <ul>
            {c.open_questions.map((q) => (
              <li key={q} className={settled.has(q) ? "done" : ""}>
                <label>
                  <input type="checkbox" checked={settled.has(q)} disabled={busy} onChange={() => toggle(q)} />
                  <span>{q}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="note">
            {decision.settled.length} of {c.open_questions.length} settled · saved with the decision
          </p>
        </div>
      )}

      {c.quality.length > 0 && (
        <details className="quality" open={weakest.length > 0}>
          <summary>
            Decision quality{weakest.length ? ` · weakest: ${weakest.map((q) => stages.get(q.stage)?.name.toLowerCase()).join(", ")}` : ""}
          </summary>
          <p className="note">
            How well the dialogue covered the six elements of decision quality; a decision is only as good as its weakest one (Spetzler, Winter &amp; Meyer,
            2016). This is Claude's reading of the dialogue, not a measurement.
          </p>
          <ul>
            {c.quality.map((q) => (
              <li key={q.stage} className={q.level}>
                <span className="q-name">{stages.get(q.stage)?.name ?? q.stage}</span>
                <span className="q-bar" aria-hidden>
                  <span />
                </span>
                <span className="q-level">{LEVEL[q.level]}</span>
                <span className="q-note">{q.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="conclusion-actions no-print">
        <button className="button" onClick={onReopen} disabled={busy}>
          Keep talking
        </button>
        <button className="button" onClick={onPanel}>
          {decision.panel ? "See what the panel said" : "Hear other minds"}
        </button>
        <button className="button quiet" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button className="button quiet" onClick={onReveal}>
          Show in folder
        </button>
      </div>
    </section>
  );
}

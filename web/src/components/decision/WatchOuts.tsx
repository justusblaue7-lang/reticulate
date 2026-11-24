import { useState } from "react";
import { DESIGN_LABEL } from "../../format";
import type { Decision, Science } from "../../types";
import { Cites } from "../Cites";
import { engagedBiases, PULL } from "./model";

/** The documented biases this decision engages, with the evidence, and a remedy where one is proven. */
export function WatchOuts({ science, decision }: { science: Science; decision: Decision }) {
  const [all, setAll] = useState(false);
  const notes = new Map(decision.watch_outs.map((w) => [w.mechanism_id, w]));
  const features = new Map(science.features.map((f) => [f.id, f]));
  const engaged = [...engagedBiases(science, decision)].sort((a, b) => b.level - a.level || Number(notes.has(b.mechanism_id)) - Number(notes.has(a.mechanism_id)));
  const main = engaged.filter((m) => m.level >= 2);
  const shown = all || main.length === 0 ? engaged : main;

  if (!engaged.length) {
    return <p className="empty">Nothing in this decision's anatomy engages a documented mechanism. Adjust the ratings above if that seems wrong.</p>;
  }

  return (
    <>
      <div className="pulls">
        {shown.map((m) => {
          const mech = science.mechanisms.find((x) => x.id === m.mechanism_id);
          if (!mech) return null;
          const note = notes.get(m.mechanism_id);
          const move = mech.countermove;
          return (
            <article key={m.mechanism_id} className={`pull level-${m.level}`}>
              <header>
                <h3>{mech.name}</h3>
                <span className="strength">
                  <span className="pips" aria-hidden>
                    {[1, 2, 3].map((l) => (
                      <i key={l} className={l <= m.level ? "on" : ""} />
                    ))}
                  </span>
                  {PULL[m.level]}
                </span>
              </header>
              <p className="pull-what">{mech.summary}</p>
              {note ? (
                <p className="pull-here">
                  <span className="kicker">In your decision</span>
                  {note.here}
                </p>
              ) : (
                <p className="pull-here">
                  <span className="kicker">Why it applies</span>
                  Your decision involves {m.features.map((f) => features.get(f)?.name.toLowerCase()).join(" and ")}.
                </p>
              )}
              {move && (
                <div className="move">
                  <span className="kicker">Proven remedy</span>
                  <p className="move-check">{note?.check || move.text}</p>
                  {note?.check && <p className="move-general">{move.text}</p>}
                </div>
              )}
              <details className="evidence">
                <summary>Evidence</summary>
                {mech.evidence.map((e, i) => (
                  <div key={i} className="evidence-item">
                    <span className="design">{DESIGN_LABEL[e.design]}</span>
                    <p>{e.finding}</p>
                    <Cites refs={e.refs} science={science} />
                  </div>
                ))}
                {move && (
                  <div className="evidence-item">
                    <span className="design">The remedy</span>
                    <p>{move.finding}</p>
                    <Cites refs={move.refs} science={science} />
                  </div>
                )}
                {!move && <p className="note">No remedy for this bias has met the evidence bar (a meta-analysis or field trials), so none is given.</p>}
              </details>
            </article>
          );
        })}
      </div>
      {main.length > 0 && engaged.length > main.length && (
        <button className="text-button more" onClick={() => setAll(!all)}>
          {all ? "Show only the likely ones" : `Show ${engaged.length - main.length} more that are possible`}
        </button>
      )}
    </>
  );
}

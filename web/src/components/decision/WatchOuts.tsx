import { useState } from "react";
import { DESIGN_LABEL } from "../../format";
import type { Decision, Science } from "../../types";
import { Cites } from "../StructureCard";
import { PULL } from "./model";

/** The documented mechanisms this decision engages, each with what to do about it. */
export function WatchOuts({ science, decision }: { science: Science; decision: Decision }) {
  const [all, setAll] = useState(false);
  const notes = new Map(decision.watch_outs.map((w) => [w.mechanism_id, w]));
  const features = new Map(science.features.map((f) => [f.id, f]));
  const engaged = [...decision.signature.mechanisms].sort((a, b) => b.level - a.level || Number(notes.has(b.mechanism_id)) - Number(notes.has(a.mechanism_id)));
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
              <div className="move">
                <span className="kicker">What to do</span>
                <p className="move-check">{note?.check || move.text}</p>
                {note?.check && <p className="move-general">{move.text}</p>}
                <span className={`basis ${move.basis}`}>{move.basis === "tested" ? "Tested in an intervention study" : "Follows from the research; not tested as an intervention"}</span>
              </div>
              <details className="evidence">
                <summary>Evidence</summary>
                {move.basis === "tested" && (
                  <div className="evidence-item">
                    <span className="design">The countermove</span>
                    <p>{move.finding}</p>
                    <Cites refs={move.refs} science={science} />
                  </div>
                )}
                {mech.evidence.map((e, i) => (
                  <div key={i} className="evidence-item">
                    <span className="design">{DESIGN_LABEL[e.design]}</span>
                    <p>{e.finding}</p>
                    <Cites refs={e.refs} science={science} />
                  </div>
                ))}
                <div className="evidence-item">
                  <span className="design">The effect</span>
                  <Cites refs={[...new Set([...mech.refs, ...(move.basis === "derived" ? move.refs : [])])]} science={science} />
                </div>
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

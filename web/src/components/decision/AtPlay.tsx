import { useState } from "react";
import type { Decision, Rating, Science } from "../../types";
import { ANSWERS, LEVEL_NAME } from "./model";
import { SelfCheck } from "./SelfCheck";

interface Props {
  science: Science;
  decision: Decision;
  busy: boolean;
  onSave: (anatomy: Rating[]) => void;
}

/** The features this decision has, strongest first, with a way to correct them. */
export function AtPlay({ science, decision, busy, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const features = new Map(science.features.map((f) => [f.id, f]));
  const present = decision.anatomy.filter((r) => r.level > 0).sort((a, b) => b.level - a.level);
  const absent = decision.anatomy.filter((r) => r.level === 0);
  const byClaude = decision.anatomy.some((r) => r.source === "model");
  const panelAtRisk = !!decision.panel?.meta.neural_context;

  const start = () => {
    setLevels(Object.fromEntries(decision.anatomy.map((r) => [r.feature_id, r.level])));
    setEditing(true);
  };
  const changed = decision.anatomy.some((r) => (levels[r.feature_id] ?? 0) !== r.level);

  if (editing) {
    return (
      <div className="adjust">
        <SelfCheck science={science} levels={levels} ratings={decision.anatomy} onChange={(id, l) => setLevels({ ...levels, [id]: l })} />
        <div className="selfcheck-foot">
          <span className="muted">
            {panelAtRisk && changed
              ? "Saving discards the panel's answers: the panel reasoned with the old ratings and would need to be asked again."
              : "Watch-outs and brain map follow your ratings."}
          </span>
          <button className="button quiet" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !changed}
            onClick={() => {
              const anatomy = decision.anatomy.map((r) =>
                (levels[r.feature_id] ?? 0) === r.level ? r : { ...r, level: levels[r.feature_id] ?? 0, source: "user" as const, reason: "" },
              );
              onSave(anatomy);
              setEditing(false);
            }}
          >
            Save ratings
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {present.length === 0 ? (
        <p className="empty">No feature is rated as present yet.</p>
      ) : (
        <ul className="at-play">
          {present.map((r) => {
            const f = features.get(r.feature_id);
            return (
              <li key={r.feature_id} className={`level-${r.level}`}>
                <span className="pips" title={LEVEL_NAME[r.level]} aria-label={LEVEL_NAME[r.level]}>
                  {[1, 2, 3].map((l) => (
                    <i key={l} className={l <= r.level ? "on" : ""} />
                  ))}
                </span>
                <span className="feature-name">{f?.name ?? r.feature_id}</span>
                <span className="feature-reason">
                  {r.reason ? (
                    <>
                      {r.reason}
                      {r.source === "user" && <span className="by"> · you</span>}
                    </>
                  ) : (
                    <span className="by">
                      You answered “{ANSWERS[r.level]}” to: {f?.ask}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="at-play-foot">
        {absent.length > 0 && (
          <p className="muted">
            Not at play: {absent.map((r) => features.get(r.feature_id)?.name.toLowerCase()).join(", ")}.
          </p>
        )}
        <button className="button small" onClick={start} disabled={busy}>
          {byClaude ? "Correct Claude's ratings" : "Change the ratings"}
        </button>
      </div>
    </>
  );
}

import type { Rating, Science } from "../../types";
import { ANSWERS } from "./model";

/** The anatomy questions in groups that read naturally; any feature not listed joins the last group. */
const GROUPS: { name: string; ids: string[] }[] = [
  { name: "What is at stake", ids: ["possible_loss", "upside", "threat", "moral_stakes"] },
  { name: "Odds and timing", ids: ["known_risk", "unknown_odds", "delayed_outcomes", "temptation"] },
  { name: "Other people", ids: ["others_affected", "social_influence", "relying_on_others"] },
  { name: "The options", ids: ["default_option", "new_territory", "prior_investment", "effort", "complexity", "anticipated_regret", "learning_from_outcomes"] },
];

interface Props {
  science: Science;
  levels: Record<string, number>;
  onChange: (featureId: string, level: number) => void;
  ratings?: Rating[]; // Claude's ratings, whose reasons are shown under each question
}

/** The decision's anatomy as questions to the user: no, a little, yes, central. */
export function SelfCheck({ science, levels, onChange, ratings }: Props) {
  const listed = new Set(GROUPS.flatMap((g) => g.ids));
  const rest = science.features.filter((f) => !listed.has(f.id)).map((f) => f.id);
  const groups = GROUPS.map((g, i) => ({ ...g, ids: i === GROUPS.length - 1 ? [...g.ids, ...rest] : g.ids }));
  const features = new Map(science.features.map((f) => [f.id, f]));
  const reasons = new Map((ratings ?? []).map((r) => [r.feature_id, r]));

  return (
    <div className="selfcheck">
      {groups.map((group) => (
        <fieldset key={group.name} className="selfcheck-group">
          <legend>{group.name}</legend>
          {group.ids
            .filter((id) => features.has(id))
            .map((id) => {
              const f = features.get(id)!;
              const level = levels[id] ?? 0;
              const rated = reasons.get(id);
              return (
                <div key={id} className={`ask ${level > 0 ? "on" : ""}`}>
                  <div className="ask-text">
                    <p>{f.ask}</p>
                    <span className="ask-name">
                      {f.name}
                      {rated?.reason && rated.source === "model" && <> · Claude: {rated.reason}</>}
                    </span>
                  </div>
                  <div className="answers" role="radiogroup" aria-label={f.ask}>
                    {ANSWERS.map((answer, l) => (
                      <button key={answer} type="button" role="radio" aria-checked={level === l} className={level === l ? "on" : ""} onClick={() => onChange(id, l)}>
                        {answer}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
        </fieldset>
      ))}
    </div>
  );
}

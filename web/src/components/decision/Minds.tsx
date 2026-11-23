import { useMemo, useState } from "react";
import { onFreeDecision } from "../../api";
import { roughly } from "../../format";
import { leanings } from "../../pattern";
import type { Avatar, Decision, Progress, Science } from "../../types";
import { displayName, Face } from "../Face";
import { estimate, observedPerCall, panelCalls, suggestPanel } from "./model";

const MAX = 6;

/** An avatar's eight tendencies as plain values, for its leanings. */
const values = (a: Avatar) => Object.fromEntries(Object.entries(a.dimensions).map(([k, v]) => [k, v.value]));

/** The attitudes that set a mind apart: its pronounced leanings, strongest first. */
export function Attitudes({ science, avatar, limit = 3 }: { science: Science; avatar: Avatar; limit?: number }) {
  const found = leanings(science, values(avatar)).slice(0, limit);
  if (!found.length) return <span className="attitude none">No pronounced leaning</span>;
  return (
    <>
      {found.map((l) => (
        <span key={l.dimension} className={`attitude ${l.strength}`} title={science.dimensions.find((d) => d.id === l.dimension)?.definition}>
          {l.poleName}
        </span>
      ))}
    </>
  );
}

interface Props {
  science: Science;
  decision: Decision;
  avatars: Avatar[];
  configured: boolean;
  running: { members: Avatar[]; progress: Progress | null } | null;
  disabled: boolean;
  onAsk: (members: Avatar[]) => void;
  onConnect: () => void;
  onReasoning: () => void;
}

/**
 * The minds at the table, beside the dialogue: each with the attitudes it reasons from.
 * Pick who should weigh in; their reasons come back into the dialogue as a question.
 */
export function Minds({ science, decision, avatars, configured, running, disabled, onAsk, onConnect, onReasoning }: Props) {
  const suggested = useMemo(() => suggestPanel(avatars, decision, science, 3), [avatars, decision, science]);
  const panel = decision.panel;
  const [picked, setPicked] = useState<string[]>(panel?.profiles.map((p) => p.id) ?? suggested);
  const [open, setOpen] = useState<string | null>(null);
  const order = [...avatars].sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id)));
  const chosen = picked.map((id) => avatars.find((a) => a.id === id)).filter((a): a is Avatar => !!a);
  const cost = estimate(panelCalls(decision, chosen.length, 1), observedPerCall(decision));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < MAX ? [...picked, id] : picked);
  const heard = (id: string) => panel?.perspectives[id]?.[0];
  const answered = (id: string) => (running?.progress?.labels[id] ?? 0) >= 1;

  return (
    <section className="minds-rail" aria-label="Minds at the table">
      <header className="rail-head">
        <h3>Minds at the table</h3>
        <p>Pick who should weigh in. Each reasons from its own attitudes; where they differ from you comes back as a question.</p>
      </header>

      <ul className="mind-list">
        {order.map((a) => {
          const on = picked.includes(a.id);
          const view = heard(a.id);
          const expanded = open === a.id;
          return (
            <li key={a.id} className={`mind ${on ? "on" : ""} ${expanded ? "open" : ""}`}>
              <div className="mind-row">
                <button className="mind-pick" role="checkbox" aria-checked={on} onClick={() => toggle(a.id)} disabled={!!running} title={on ? "Take off the table" : "Bring to the table"}>
                  <span className={`mind-face ${running && on ? (answered(a.id) ? "done" : "busy") : ""}`}>
                    <Face avatar={a} size={40} />
                  </span>
                  <span className="mind-id">
                    <strong>{displayName(a)}</strong>
                    {a.person?.name && <small>{a.name}</small>}
                  </span>
                  <span className="mind-check" aria-hidden />
                </button>
                <button className="mind-more" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.id)} title="Their attitudes in full">
                  {expanded ? "−" : "+"}
                </button>
              </div>
              <div className="attitudes">
                <Attitudes science={science} avatar={a} limit={expanded ? 8 : 3} />
              </div>
              {view && (
                <p className="mind-take">
                  <span className="take-choice">{view.recommendation}</span>
                  {view.summary}
                </p>
              )}
              {expanded && (
                <div className="mind-detail">
                  <p>{a.summary}</p>
                  {a.priorities.length > 0 && (
                    <p>
                      <span className="kicker">Puts first</span>
                      {a.priorities.join(", ")}
                    </p>
                  )}
                  {a.personality?.values.length ? (
                    <p>
                      <span className="kicker">Values</span>
                      {a.personality.values.map((v) => science.personality.values.find((x) => x.id === v)?.name ?? v).join(", ")}
                    </p>
                  ) : null}
                  {a.context?.goals.length ? (
                    <p>
                      <span className="kicker">Wants</span>
                      {a.context.goals.join("; ")}
                    </p>
                  ) : null}
                  {a.context?.constraints.length ? (
                    <p>
                      <span className="kicker">Bound by</span>
                      {a.context.constraints.join("; ")}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="rail-foot">
        {running ? (
          <p className="note" role="status">
            <span className="spinner tiny" /> {running.members.length} {running.members.length === 1 ? "mind is" : "minds are"} thinking it through
            {running.progress ? ` · ${running.progress.done} of ${running.progress.total}` : ""}. Keep talking meanwhile.
          </p>
        ) : configured ? (
          <button className="button primary block" disabled={disabled || !chosen.length} onClick={() => onAsk(chosen)}>
            {panel ? "Ask again" : "Ask them"} · {chosen.length} {chosen.length === 1 ? "mind" : "minds"} · {onFreeDecision(decision) ? "free" : roughly(cost.usd)}
          </button>
        ) : (
          <button className="button block" onClick={onConnect}>
            Connect Claude to ask them
          </button>
        )}
        <p className="fine">
          Simulated from the attitudes shown, not real people, and not a prediction. Up to {MAX}.{" "}
          {panel && (
            <button className="text-button" onClick={onReasoning}>
              Read their full reasoning
            </button>
          )}
        </p>
      </footer>
    </section>
  );
}

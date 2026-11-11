import { useEffect, useState } from "react";
import type { Decision } from "../../types";
import { unique } from "./model";

const storageKey = (id: string) => `reticulate.homework.${id}`;

function load(id: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) ?? "[]");
  } catch {
    return [];
  }
}

/** What to find out before deciding: the frame's unknowns and the panel's questions, as a checklist. */
export function Homework({ decision }: { decision: Decision }) {
  const [done, setDone] = useState<string[]>(() => load(decision.id));
  useEffect(() => setDone(load(decision.id)), [decision.id]);
  const toggle = (item: string) => {
    const next = done.includes(item) ? done.filter((x) => x !== item) : [...done, item];
    setDone(next);
    try {
      localStorage.setItem(storageKey(decision.id), JSON.stringify(next));
    } catch {
      // A private window may refuse storage; the checklist then lasts for this visit.
    }
  };

  const panel = decision.panel;
  const views = panel ? panel.profiles.flatMap((p) => panel.perspectives[p.id]) : [];
  const groups = [
    { title: "Find out", note: "Missing information that could change the decision.", items: unique(decision.frame?.unknowns ?? []) },
    { title: "Questions the panel asked", note: "What the avatars needed answered before committing.", items: unique(views.flatMap((v) => v.key_questions)).slice(0, 8) },
    { title: "What would change minds", note: "Evidence or events that would reverse a recommendation.", items: unique(views.flatMap((v) => v.would_change_mind)).slice(0, 8) },
  ].filter((g) => g.items.length);

  if (!groups.length) {
    return <p className="empty">The panel's questions appear here once it has reasoned.</p>;
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const checked = groups.reduce((n, g) => n + g.items.filter((i) => done.includes(i)).length, 0);

  return (
    <>
      <p className="homework-count muted">
        {checked} of {total} settled · ticks are kept in this browser
      </p>
      <div className="homework">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="subhead">{g.title}</h3>
            <p className="note">{g.note}</p>
            <ul>
              {g.items.map((item) => (
                <li key={item} className={done.includes(item) ? "done" : ""}>
                  <label>
                    <input type="checkbox" checked={done.includes(item)} onChange={() => toggle(item)} />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { PUBLIC, api } from "../api";
import { SHORT } from "../format";
import { itemOrder, leaningOf, leanings } from "../pattern";
import type { PersonalPattern, Science } from "../types";
import { Glyph } from "./Glyph";
import { Kbd, MOD, Mark } from "./Mark";

interface Props {
  science: Science;
  pattern: PersonalPattern | null;
  onPattern: (pattern: PersonalPattern | null) => void;
}

const values = (p: PersonalPattern) => Object.fromEntries(Object.entries(p.dimensions).map(([k, v]) => [k, v.value]));
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Your pattern: sixteen statements, then what the dialogue will watch for. */
export function PatternCheck({ science, pattern, onPattern }: Props) {
  const [mode, setMode] = useState<"check" | "result" | "adjust">(pattern ? "result" : "check");
  const [answers, setAnswers] = useState<Record<string, number>>(pattern?.answers ?? {});
  const [adjust, setAdjust] = useState<Record<string, number>>({});
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => itemOrder(science), [science]);
  const done = items.filter((i) => answers[i.id]).length;
  const complete = done === items.length;
  const scale = science.pattern.method.scale;

  useEffect(() => {
    if (pattern && mode === "check" && !Object.keys(answers).length) setAnswers(pattern.answers);
  }, [pattern, mode, answers]);

  const answer = (index: number, value: number) => {
    const next = { ...answers, [items[index].id]: value };
    setAnswers(next);
    const after = items.findIndex((it, i) => i > index && !next[it.id]);
    const before = items.findIndex((it) => !next[it.id]);
    setActive(after >= 0 ? after : before >= 0 ? before : index);
  };

  const save = async (adjustments: Record<string, number> = {}) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.savePattern(answers, adjustments);
      onPattern(saved);
      setMode("result");
      setAdjust({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Keyboard first: 1–5 answer the current statement, ↑↓ move, ⌘↵ saves.
  useEffect(() => {
    if (mode !== "check") return;
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Only while the check has focus (a click anywhere in it gives it focus).
      if (!target.closest(".pattern-check") || target.closest("input, textarea, [contenteditable]") || e.altKey) return;
      if (/^[1-5]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        answer(active, Number(e.key));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && complete) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (mode !== "check" && pattern) {
    const current = mode === "adjust" ? { ...values(pattern), ...adjust } : values(pattern);
    const found = leanings(science, current);
    return (
      <div className="card pattern-result">
        <div className="pattern-result-grid">
          <div>
            <div className="pattern-glyph">
              <Glyph scores={science.dimensions.map((d) => current[d.id])} size={170} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
            </div>
            {mode === "adjust" ? (
              <div className="pattern-sliders">
                {science.dimensions.map((d) => (
                  <label key={d.id} className="pattern-slider">
                    <span className="name">{d.name}</span>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={0.25}
                      value={current[d.id]}
                      onChange={(e) => setAdjust({ ...adjust, [d.id]: Number(e.target.value) })}
                    />
                    <span className="poles">
                      <span>{d.low_pole}</span>
                      <span>{d.high_pole}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <ul className="pattern-bars">
                {science.dimensions.map((d) => {
                  const v = current[d.id];
                  const lean = found.find((l) => l.dimension === d.id);
                  return (
                    <li key={d.id} className={lean ? lean.strength : ""} title={`${d.name}: ${d.definition}`}>
                      <span className="pb-name">{d.name}</span>
                      <span className="pb-lean">{lean ? lean.poleName : "No leaning"}</span>
                      <span className="pb-track" aria-label={`${d.low_pole} to ${d.high_pole}`}>
                        <span className="pb-span" style={{ left: `${Math.min(v, 5) * 10}%`, width: `${Math.abs(v - 5) * 10}%` }} />
                        <span className="pb-dot" style={{ left: `${v * 10}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="pattern-watch">
            <h3>What the dialogue will watch for</h3>
            {found.length === 0 ? (
              <p className="note">No pronounced leaning. The dialogue spends its questions where this decision needs them most.</p>
            ) : (
              <ul>
                {found.map((l) => {
                  const lean = leaningOf(science, l.dimension, l.pole)!;
                  return (
                    <li key={l.dimension} className={l.strength}>
                      <div className="pw-head">
                        <strong>{l.poleName}</strong>
                        <span className="rc-tag">{l.strength === "clear" ? "Clear leaning" : "Some leaning"}</span>
                      </div>
                      <p className="pw-watch">{lean.watch}</p>
                      <p className="pw-ask">
                        <span>Counterweight</span> {lean.counterweight}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pattern-provenance">
              Self-rated on {date(pattern.updated_at)}
              {Object.values(pattern.dimensions).some((d) => d.adjusted) ? ", adjusted by you" : ""}. A description of how you usually decide,
              not a measurement. New dialogues use it; dialogues already started keep the pattern they began with. Saved {PUBLIC ? "in this browser" : "on this computer"} only.
            </p>
            {error && <p className="error">{error}</p>}
            <div className="pattern-actions">
              {mode === "adjust" ? (
                <>
                  <button className="button primary" disabled={saving} onClick={() => void save(Object.fromEntries(science.dimensions.map((d) => [d.id, current[d.id]])))}>
                    {saving ? "Saving…" : "Save the adjustments"}
                  </button>
                  <button className="button quiet" onClick={() => { setAdjust({}); setMode("result"); }}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="button dark" onClick={() => { setAnswers(pattern.answers); setActive(0); setMode("check"); }}>
                    Change my answers
                  </button>
                  <button className="button dark" onClick={() => setMode("adjust")}>
                    Adjust
                  </button>
                  <button
                    className="button quiet danger"
                    onClick={async () => {
                      if (!confirm("Delete your pattern? New dialogues will no longer use it.")) return;
                      await api.deletePattern();
                      onPattern(null);
                      setAnswers({});
                      setMode("check");
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rc-window pattern-check" tabIndex={-1}>
      <div className="rc-search pc-head">
        <span className="pc-title">How do you usually decide?</span>
        <span className="pc-progress" aria-live="polite">
          <span className="pc-bar">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </span>
          {done}/{items.length}
        </span>
      </div>
      <div className="pc-scale" aria-hidden>
        <span />
        {scale.map((label, i) => (
          <span key={label}>
            <Kbd>{i + 1}</Kbd>
            {label}
          </span>
        ))}
      </div>
      <ol className="pc-list">
        {items.map((item, i) => (
          <li key={item.id} className={`pc-item ${i === active ? "on" : ""} ${answers[item.id] ? "answered" : ""}`} onClick={() => setActive(i)}>
            <span className="pc-text">{item.text}</span>
            <span className="pc-answers" role="radiogroup" aria-label={item.text}>
              {scale.map((label, v) => (
                <button
                  key={label}
                  role="radio"
                  aria-checked={answers[item.id] === v + 1}
                  aria-label={label}
                  title={label}
                  className={answers[item.id] === v + 1 ? "on" : ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    answer(i, v + 1);
                  }}
                />
              ))}
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="error pc-error">{error}</p>}
      <div className="rc-actionbar">
        <div className="rc-actionbar-left">
          <Mark size={18} />
          <span>Self-rated · about two minutes · stays {PUBLIC ? "in this browser" : "on this computer"}</span>
        </div>
        <div className="rc-actionbar-right">
          <span className="rc-hint">
            Answer <Kbd>1</Kbd>–<Kbd>5</Kbd>
          </span>
          <span className="rc-divider" />
          {pattern && (
            <>
              <button className="rc-action" onClick={() => setMode("result")}>
                Cancel
              </button>
              <span className="rc-divider" />
            </>
          )}
          <button className="rc-action primary" disabled={!complete || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "See my pattern"}
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

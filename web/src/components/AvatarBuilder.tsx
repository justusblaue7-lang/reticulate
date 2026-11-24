// Build or edit an avatar: who it is shown as (a 3D person, changed as you like, and a name), its
// role and situation, personality (Big Five and values) and the six attitudes of the Global
// Preferences Survey.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { SHORT } from "../format";
import { loadCatalogue, portraitUrl, type PersonAsset } from "../people/catalogue";
import { PersonViewer } from "../people/PersonViewer";
import { BUILD, CLOTHES, HAIR, HEIGHT, PLAIN, SKIN, styled, type Swatch } from "../people/style";
import type { Avatar, Person, PersonStyle, Science } from "../types";
import { Glyph } from "./Glyph";

export function blankAvatar(science: Science): Avatar {
  const score = (value: number) => ({ value, provenance: "authored" as const, uncertainty: null, source: null });
  return {
    id: "new",
    name: "",
    kind: "persona",
    origin: "user",
    summary: "",
    nuance: "",
    priorities: [],
    voice: "",
    dimensions: Object.fromEntries(science.dimensions.map((d) => [d.id, score(5)])),
    personality: { traits: Object.fromEntries(science.personality.traits.map((t) => [t.id, score(5)])), values: [] },
    context: { goals: [], constraints: [], notes: "" },
    person: null,
  };
}

/** A copy of someone else's mind to change, with a new id; the user's own are edited as they are. */
export function variantOf(avatar: Avatar): Avatar {
  if (avatar.origin === "user") return { ...avatar };
  return { ...avatar, id: "new", origin: "user", name: `${avatar.name} (variant)`, person: avatar.person ? { ...avatar.person, name: "" } : null };
}

/** Save a mind; a changed look gets its pictures rendered first, so lists show it as changed. */
export async function saveMind(draft: Avatar): Promise<Avatar> {
  const given = draft.person;
  let person: Person | null = given && (given.look || given.name.trim()) ? { ...given, name: given.name.trim() } : null;
  if (person) {
    const style = styled(person.style) ? person.style : null;
    const stills = style && person.look ? await import("../people/stills").then((m) => m.renderStills(person!.look, style)).catch(() => null) : null;
    person = { ...person, style, stills };
  }
  return api.saveAvatar({ ...draft, person });
}

// Headscarves and hats are drawn like hair; there, hair colour would colour the scarf.
const COVERED = new Set(["female_adult_06"]);
const hasHair = (asset: PersonAsset | undefined) => !!asset && !COVERED.has(asset.look) && Object.values(asset.parts).some((maps) => maps.includes("alpha"));

/** The cast of 3D people to start a look from. */
function LookPicker({ people, value, onChange }: { people: PersonAsset[]; value: string | null; onChange: (look: string) => void }) {
  if (!people.length) return <p className="note">No 3D people are built yet. Run tools/people/build.py.</p>;
  return (
    <div className="look-picker" role="radiogroup" aria-label="Start from">
      {people.map((p, i) => (
        <button key={p.look} role="radio" aria-checked={value === p.look} aria-label={`Person ${i + 1}`} className={value === p.look ? "on" : ""} onClick={() => onChange(p.look)}>
          <img src={portraitUrl(p.look)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

/** One colour of the look: as built, or one of a palette. */
function Swatches({ label, value, options, onChange, kind, disabled }: {
  label: string;
  value: string | null;
  options: Swatch[];
  onChange: (hex: string | null) => void;
  kind: "skin" | "hair" | "clothes";
  disabled?: string;
}) {
  const chosen = options.find((o) => o.hex === value);
  return (
    <div className="control swatch-control">
      <span className="label">
        <span>{label}</span>
        <span className="swatch-name">{disabled ? "" : chosen ? chosen.name.replace(/ of 10.*$/, "") : "As built"}</span>
      </span>
      {disabled ? (
        <p className="note">{disabled}</p>
      ) : (
        <div className={`swatches ${kind}`} role="radiogroup" aria-label={label}>
          <button role="radio" aria-checked={!value} aria-label="As built" title="As built" className={`swatch own ${!value ? "on" : ""}`} onClick={() => onChange(null)} />
          {options.map((o) => (
            <button
              key={o.hex}
              role="radio"
              aria-checked={value === o.hex}
              aria-label={o.name}
              title={o.name}
              className={`swatch ${value === o.hex ? "on" : ""}`}
              style={{ "--swatch": o.hex } as CSSProperties}
              onClick={() => onChange(o.hex)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const percent = (factor: number) => {
  const p = Math.round((factor - 1) * 100);
  return p === 0 ? "As built" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`;
};

function Slider({ label, value, min = 0, max = 10, step = 1, onChange, low, high, display }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  low?: string;
  high?: string;
  display?: string;
}) {
  return (
    <label className="control dimension-control">
      <span className="label">
        <span>{label}</span>
        <span className="mono" style={{ color: "var(--cream)" }}>{display ?? value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {(low || high) && (
        <span className="poles">
          <span>{low}</span>
          <span>{high}</span>
        </span>
      )}
    </label>
  );
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  const [adding, setAdding] = useState("");
  const commit = () => {
    if (adding.trim()) onChange([...items, adding.trim()]);
    setAdding("");
  };
  return (
    <div className="list-editor">
      {items.map((item, i) => (
        <div className="row" key={i}>
          <input
            className="field"
            value={item}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
            onBlur={() => onChange(items.filter((x) => x.trim()))}
          />
          <button className="icon-button" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label="Remove">
            ×
          </button>
        </div>
      ))}
      <input
        className="field"
        value={adding}
        placeholder={placeholder}
        onChange={(e) => setAdding(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

interface Props {
  science: Science;
  draft: Avatar;
  onChange: (avatar: Avatar) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export function AvatarBuilder({ science, draft, onChange, onSave, onCancel, saving, error }: Props) {
  const personality = draft.personality ?? blankAvatar(science).personality!;
  const context = draft.context ?? { goals: [], constraints: [], notes: "" };
  const person: Person = draft.person ?? { name: "", look: "" };
  const style: PersonStyle = person.style ?? PLAIN;
  const [people, setPeople] = useState<PersonAsset[]>([]);
  const [built, setBuilt] = useState<{ look: string; height: number } | null>(null);
  useEffect(() => {
    void loadCatalogue().then(setPeople);
  }, []);
  const asset = people.find((p) => p.look === person.look);
  const setStyle = (change: Partial<PersonStyle>) => onChange({ ...draft, person: { ...person, style: { ...style, ...change } } });
  const height = built && built.look === person.look ? `${Math.round(built.height * style.height * 100)} cm` : percent(style.height);
  const setDim = (id: string, value: number) =>
    onChange({ ...draft, dimensions: { ...draft.dimensions, [id]: { value, provenance: "authored", uncertainty: null, source: "builder" } } });
  const setTrait = (id: string, value: number) =>
    onChange({ ...draft, personality: { ...personality, traits: { ...personality.traits, [id]: { value, provenance: "authored", uncertainty: null, source: "builder" } } } });
  const toggleValue = (id: string) => {
    const has = personality.values.includes(id);
    const values = has ? personality.values.filter((v) => v !== id) : personality.values.length < 3 ? [...personality.values, id] : personality.values;
    onChange({ ...draft, personality: { ...personality, values } });
  };

  return (
    <div className="builder">
      <div className="builder-preview">
        <PersonViewer
          look={person.look || null}
          style={person.style}
          name={person.name || draft.name}
          className="builder-person"
          onMeasure={(h) => person.look && setBuilt({ look: person.look, height: h })}
        />
        <Glyph scores={science.dimensions.map((d) => draft.dimensions[d.id].value)} size={150} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
        <div className="builder-actions">
          <button className="button primary" disabled={saving || draft.name.trim().length < 2} onClick={() => onSave()}>
            {saving ? "Saving…" : "Save mind"}
          </button>
          <button className="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div>
        <fieldset className="control-group">
          <legend>Identity and situation</legend>
          <div className="controls-grid">
            <label className="control">
              <span className="label">Name · shown only to you</span>
              <input className="field" value={person.name} placeholder="e.g. Clara Weiß" onChange={(e) => onChange({ ...draft, person: { ...person, name: e.target.value } })} />
            </label>
            <label className="control">
              <span className="label">Role · what the simulation sees</span>
              <input className="field" value={draft.name} placeholder="e.g. Founder of a regional bakery chain" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
            </label>
          </div>
          <label className="control" style={{ marginTop: 14 }}>
            <span className="label">Voice</span>
            <input className="field" value={draft.voice} placeholder="How this person talks and argues" onChange={(e) => onChange({ ...draft, voice: e.target.value })} />
          </label>
          <label className="control" style={{ marginTop: 14 }}>
            <span className="label">Situation</span>
            <textarea className="field" rows={2} value={draft.summary} onChange={(e) => onChange({ ...draft, summary: e.target.value })} />
          </label>
          <label className="control" style={{ marginTop: 14 }}>
            <span className="label">Beyond the stereotype</span>
            <textarea className="field" rows={2} value={draft.nuance} placeholder="Where this person departs from what the role suggests" onChange={(e) => onChange({ ...draft, nuance: e.target.value })} />
          </label>
          <div className="controls-grid" style={{ marginTop: 14 }}>
            <div className="control">
              <span className="label">Goals</span>
              <ListEditor items={context.goals} placeholder="Add a goal" onChange={(goals) => onChange({ ...draft, context: { ...context, goals } })} />
            </div>
            <div className="control">
              <span className="label">Constraints</span>
              <ListEditor items={context.constraints} placeholder="Add a constraint" onChange={(constraints) => onChange({ ...draft, context: { ...context, constraints } })} />
            </div>
          </div>
        </fieldset>

        <fieldset className="control-group look-group">
          <legend>Look</legend>
          <p className="note">
            Start from one of {people.length || "the"} realistic people (Microsoft Rocketbox library), then make them your own. The look and
            the name only show who this mind is; neither ever enters a simulation, so a decision cannot lean on how someone looks or what they
            are called.
          </p>
          <span className="label look-label">Start from · face, hair style and clothes</span>
          <LookPicker people={people} value={person.look || null} onChange={(look) => onChange({ ...draft, person: { ...person, look } })} />
          {person.look ? (
            <div className="look-controls">
              <Swatches label="Skin" kind="skin" value={style.skin} options={SKIN} onChange={(skin) => setStyle({ skin })} />
              <Swatches
                label="Hair"
                kind="hair"
                value={style.hair}
                options={HAIR}
                onChange={(hair) => setStyle({ hair })}
                disabled={asset && !hasHair(asset) ? "This person's hair is painted on or covered and keeps its colour." : undefined}
              />
              <Swatches label="Top" kind="clothes" value={style.top} options={CLOTHES} onChange={(top) => setStyle({ top })} />
              <Swatches label="Bottom" kind="clothes" value={style.bottom} options={CLOTHES} onChange={(bottom) => setStyle({ bottom })} />
              <div className="controls-grid">
                <Slider label="Height" value={style.height} min={HEIGHT.min} max={HEIGHT.max} step={0.01} display={height} low="Shorter" high="Taller" onChange={(h) => setStyle({ height: h })} />
                <Slider label="Build" value={style.build} min={BUILD.min} max={BUILD.max} step={0.01} display={percent(style.build)} low="Slighter" high="Broader" onChange={(b) => setStyle({ build: b })} />
              </div>
              {styled(person.style) && (
                <button className="text-button look-reset" onClick={() => onChange({ ...draft, person: { ...person, style: null } })}>
                  Back to the person as built
                </button>
              )}
            </div>
          ) : (
            <p className="note">Choose a person above to change skin, hair, clothes, height and build.</p>
          )}
        </fieldset>

        <fieldset className="control-group">
          <legend>Personality</legend>
          <p className="note">Big Five traits, 5 = population average; measurable with the BFI-2 (Soto &amp; John, 2017).</p>
          <div className="controls-grid">
            {science.personality.traits.map((t) => (
              <Slider key={t.id} label={t.name} value={personality.traits[t.id].value} low={t.low_pole} high={t.high_pole} onChange={(v) => setTrait(t.id, v)} />
            ))}
          </div>
          <div className="control" style={{ marginTop: 16 }}>
            <span className="label">Values that matter most · up to three (Schwartz, 1992)</span>
            <div className="values-list">
              {science.personality.values.map((v) => (
                <button key={v.id} className={`value-chip ${personality.values.includes(v.id) ? "on" : ""}`} title={v.definition} onClick={() => toggleValue(v.id)}>
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="control-group">
          <legend>Decision profile</legend>
          <p className="note">Their answers to the six questions of the Global Preferences Survey, 0 to 10. The outline beside the person follows them.</p>
          <div className="controls-grid">
            {science.dimensions.map((d) => (
              <Slider key={d.id} label={d.name} value={draft.dimensions[d.id].value} low={d.low_pole} high={d.high_pole} onChange={(v) => setDim(d.id, v)} />
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

/**
 * The builder over the page, for building a mind without leaving a decision. Closing asks first
 * once something has been entered; the mind is saved like any other and can be brought to the table.
 */
export function MindDialog({ science, start, onSaved, onClose }: { science: Science; start: Avatar | null; onSaved: (avatar: Avatar) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Avatar>(() => start ?? blankAvatar(science));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = useRef(JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== initial.current;
  const close = () => {
    if (!dirty || confirm("Discard this mind? What you entered is not saved.")) onClose();
  };
  const latestClose = useRef(close);
  latestClose.current = close;

  useEffect(() => {
    document.body.classList.add("dialog-open");
    const key = (e: KeyboardEvent) => e.key === "Escape" && latestClose.current();
    window.addEventListener("keydown", key);
    return () => {
      document.body.classList.remove("dialog-open");
      window.removeEventListener("keydown", key);
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveMind(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-scrim builder-scrim">
      <div className="builder-modal" role="dialog" aria-modal="true" aria-labelledby="mind-dialog-title">
        <header className="builder-modal-head">
          <div>
            <span className="eyebrow">{start?.origin === "user" ? "Your mind" : start ? "A variant" : "Your own mind"}</span>
            <h2 id="mind-dialog-title">{start?.origin === "user" ? `Edit ${start.person?.name || start.name}` : "Build a mind for the table"}</h2>
          </div>
          <button className="text-button" onClick={close}>
            Close
          </button>
        </header>
        <AvatarBuilder science={science} draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={close} saving={saving} error={error} />
      </div>
    </div>,
    document.body,
  );
}

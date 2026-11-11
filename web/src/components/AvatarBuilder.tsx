// Build or edit an avatar: identity and situation, phenotype (drawn live as a cameo),
// personality (Big Five and values) and the eight decision dimensions (with their brain map).

import { useState, type ReactNode } from "react";
import { Cameo, HAIR_TONES, SKIN_TONES } from "../portrait/Cameo";
import type { Avatar, Hair, HairColor, Phenotype, Science } from "../types";
import { SHORT } from "../format";
import { Glyph } from "./Glyph";

export const DEFAULT_PHENOTYPE: Phenotype = {
  age: 40,
  skin: 3,
  face: 0.5,
  nose: "straight",
  lips: 0.5,
  build: 0.5,
  hair: "short",
  hair_color: "dark_brown",
  facial_hair: "none",
  glasses: "none",
  attire: "crew",
};

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
    phenotype: { ...DEFAULT_PHENOTYPE },
  };
}

const HAIR: Hair[] = ["bald", "buzz", "short", "swept", "wavy", "long", "curly", "coily", "locs", "braids", "bun", "headscarf"];
const HAIR_COLORS = Object.keys(HAIR_TONES) as HairColor[];

function Choice<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="choice-row">
      {options.map((o) => (
        <button key={o} className={o === value ? "on" : ""} onClick={() => onChange(o)}>
          {label ? label(o) : o.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}

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
  brain: ReactNode; // the live construct-emphasis map
}

export function AvatarBuilder({ science, draft, onChange, onSave, onCancel, saving, error, brain }: Props) {
  const ph = draft.phenotype ?? DEFAULT_PHENOTYPE;
  const personality = draft.personality ?? blankAvatar(science).personality!;
  const context = draft.context ?? { goals: [], constraints: [], notes: "" };
  const setPh = (patch: Partial<Phenotype>) => onChange({ ...draft, phenotype: { ...ph, ...patch } });
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
        <Cameo phenotype={ph} size={330} title={draft.name || "New avatar"} />
        <Glyph scores={science.dimensions.map((d) => draft.dimensions[d.id].value)} size={150} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
        <div className="brain-box">{brain}</div>
        <div className="builder-actions">
          <button className="button primary" disabled={saving || draft.name.trim().length < 2} onClick={onSave}>
            {saving ? "Saving…" : "Save avatar"}
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
              <span className="label">Role</span>
              <input className="field" value={draft.name} placeholder="e.g. Founder of a regional bakery chain" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
            </label>
            <label className="control">
              <span className="label">Voice</span>
              <input className="field" value={draft.voice} placeholder="How this person talks and argues" onChange={(e) => onChange({ ...draft, voice: e.target.value })} />
            </label>
          </div>
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

        <fieldset className="control-group">
          <legend>Phenotype</legend>
          <p className="note">Draws the portrait only. Appearance never enters a simulation, so a decision cannot lean on stereotypes about how people look.</p>
          <div className="controls-grid">
            <Slider label="Age" value={ph.age} min={18} max={90} onChange={(age) => setPh({ age })} />
            <div className="control">
              <span className="label">Skin tone</span>
              <div className="swatches">
                {SKIN_TONES.map((c, i) => (
                  <button key={c} className={ph.skin === i ? "on" : ""} style={{ background: c }} onClick={() => setPh({ skin: i })} aria-label={`Skin tone ${i + 1}`} />
                ))}
              </div>
            </div>
            <Slider label="Face" value={ph.face} min={0} max={1} step={0.05} low="Fine" high="Strong" display={ph.face.toFixed(2)} onChange={(face) => setPh({ face })} />
            <Slider label="Build" value={ph.build} min={0} max={1} step={0.05} low="Slight" high="Heavy" display={ph.build.toFixed(2)} onChange={(build) => setPh({ build })} />
            <Slider label="Lips" value={ph.lips} min={0} max={1} step={0.05} low="Thin" high="Full" display={ph.lips.toFixed(2)} onChange={(lips) => setPh({ lips })} />
            <div className="control">
              <span className="label">Nose</span>
              <Choice options={["straight", "aquiline", "concave", "broad"] as const} value={ph.nose} onChange={(nose) => setPh({ nose })} />
            </div>
          </div>
          <div className="control" style={{ marginTop: 14 }}>
            <span className="label">Hair</span>
            <Choice options={HAIR} value={ph.hair} onChange={(hair) => setPh({ hair })} />
          </div>
          <div className="controls-grid" style={{ marginTop: 14 }}>
            <div className="control">
              <span className="label">Hair colour</span>
              <div className="swatches">
                {HAIR_COLORS.map((c) => (
                  <button key={c} className={ph.hair_color === c ? "on" : ""} style={{ background: HAIR_TONES[c] }} onClick={() => setPh({ hair_color: c })} title={c.replace("_", " ")} />
                ))}
              </div>
            </div>
            <div className="control">
              <span className="label">Facial hair</span>
              <Choice options={["none", "stubble", "moustache", "beard", "full_beard"] as const} value={ph.facial_hair} onChange={(facial_hair) => setPh({ facial_hair })} />
            </div>
            <div className="control">
              <span className="label">Glasses</span>
              <Choice options={["none", "round", "rectangular"] as const} value={ph.glasses} onChange={(glasses) => setPh({ glasses })} />
            </div>
            <div className="control">
              <span className="label">Attire</span>
              <Choice options={["crew", "knit", "collar", "blazer", "turtleneck"] as const} value={ph.attire} onChange={(attire) => setPh({ attire })} />
            </div>
          </div>
        </fieldset>

        <fieldset className="control-group">
          <legend>Personality</legend>
          <p className="note">Big Five traits, 5 = population average; measurable with the BFI-2 (Soto &amp; John, 2017). No brain map: structural brain–personality associations do not replicate in large samples (Avinun et al., 2020).</p>
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
          <p className="note">Eight decision tendencies, 5 = no leaning. The brain map beside the portrait follows them.</p>
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

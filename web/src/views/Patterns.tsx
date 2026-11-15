import { useState } from "react";
import { api } from "../api";
import type { Atlas } from "../atlas/load";
import { emphasisOverlay, useConstructMaps } from "../brain/emphasis";
import type { BrainRenderer } from "../brain/renderer";
import { AvatarBuilder, blankAvatar } from "../components/AvatarBuilder";
import { displayName, Face } from "../components/Face";
import { Glyph } from "../components/Glyph";
import { ScaleRow } from "../components/ScaleRow";
import { SourceSwitch } from "../components/SourceSwitch";
import { Specimen, type OverlaySpec } from "../components/Specimen";
import { SHORT } from "../format";
import { PersonViewer } from "../people/PersonViewer";
import type { Avatar, Science, Source } from "../types";

interface Props {
  atlas: Atlas;
  science: Science;
  renderer: BrainRenderer;
  avatars: Avatar[];
  onAvatars: (avatars: Avatar[]) => void;
}

/** Cognitive patterns: simulated decision-makers, each defined by eight tendencies. */
export function Patterns({ atlas, science, renderer, avatars, onAvatars }: Props) {
  const [selectedId, setSelectedId] = useState<string>(avatars[0]?.id ?? "");
  const [draft, setDraft] = useState<Avatar | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("neuroquery");
  const [threshold, setThreshold] = useState(3.1);
  const [focus, setFocus] = useState<string | null>(null); // a dimension whose construct map is shown
  const maps = useConstructMaps(atlas, science, source);

  const selected = avatars.find((a) => a.id === selectedId) ?? avatars[0];
  const shown = draft ?? selected;

  let overlay: OverlaySpec | null = null;
  if (maps && shown) {
    if (focus && maps[focus]) {
      const d = science.dimensions.find((x) => x.id === focus)!;
      const entry = atlas.catalogue.maps.find((m) => m.id === `construct.${focus}`)!;
      overlay = {
        id: `construct.${focus}.${source}`,
        values: maps[focus],
        max: entry.sources[source]?.display_max ?? 8,
        title: `Construct · ${d.name}`,
        source: `${source === "neuroquery" ? "NeuroQuery" : "Neurosynth"} map of “${source === "neuroquery" ? d.construct_map.query : d.construct_map.neurosynth.join(", ")}”`,
        unit: "z",
        fire: 0,
      };
    } else {
      overlay = emphasisOverlay(science, shown, maps, source, threshold);
    }
  }

  const brain = (bare: boolean) => (
    <Specimen
      bare={bare}
      renderer={renderer}
      atlas={atlas}
      networks={science.networks}
      layer="plain"
      overlay={overlay}
      threshold={threshold}
      onThreshold={setThreshold}
      compact
      legendExtra={<SourceSwitch value={source} onChange={(c) => c !== "both" && setSource(c)} available={{ neuroquery: true, neurosynth: true }} both={false} />}
    />
  );

  const pick = (a: Avatar) => {
    setDraft(null);
    setFocus(null);
    setSelectedId(a.id);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const person = draft.person && (draft.person.look || draft.person.name.trim()) ? { ...draft.person, name: draft.person.name.trim() } : null;
    try {
      const saved = await api.saveAvatar({ ...draft, person });
      onAvatars(avatars.some((a) => a.id === saved.id) ? avatars.map((a) => (a.id === saved.id ? saved : a)) : [...avatars, saved]);
      setSelectedId(saved.id);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (avatar: Avatar) => {
    if (!confirm(`Delete “${avatar.name}”? This cannot be undone.`)) return;
    await api.deleteAvatar(avatar.id);
    const rest = avatars.filter((a) => a.id !== avatar.id);
    onAvatars(rest);
    setSelectedId(rest[0]?.id ?? "");
  };

  return (
    <div className="patterns">
      <div className="pattern-strip" role="tablist" aria-label="Cognitive patterns">
        {avatars.map((a) => (
          <button key={a.id} role="tab" aria-selected={!draft && a.id === selected?.id} className={`pattern-chip ${!draft && a.id === selected?.id ? "on" : ""}`} onClick={() => pick(a)} title={a.summary}>
            <Face avatar={a} size={28} />
            <span>{displayName(a)}</span>
            {a.origin === "user" && <span className="rc-tag">Yours</span>}
          </button>
        ))}
        <button className={`pattern-chip add ${draft?.id === "new" ? "on" : ""}`} onClick={() => { setFocus(null); setDraft(blankAvatar(science)); }}>
          <span className="plus">+</span>
          <span>Build your own</span>
        </button>
      </div>

      <div className="card pattern-card">
        {draft ? (
          <AvatarBuilder science={science} draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} error={error} brain={brain(true)} />
        ) : selected ? (
          <Dossier
            science={science}
            avatar={selected}
            brain={brain(false)}
            focus={focus}
            onFocus={setFocus}
            onEdit={() =>
              setDraft(
                selected.origin === "user"
                  ? { ...selected }
                  : { ...selected, id: "new", origin: "user", name: `${selected.name} (variant)`, person: selected.person ? { ...selected.person, name: "" } : null },
              )
            }
            onDelete={selected.origin === "user" ? () => void remove(selected) : null}
          />
        ) : null}
      </div>
    </div>
  );
}

function Dossier({ science, avatar, brain, focus, onFocus, onEdit, onDelete }: {
  science: Science;
  avatar: Avatar;
  brain: React.ReactNode;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onEdit: () => void;
  onDelete: (() => void) | null;
}) {
  const values = new Map(science.personality.values.map((v) => [v.id, v]));
  const focused = science.dimensions.find((d) => d.id === focus);
  return (
    <div className="dossier-grid">
      <div className="dossier-side">
        <header className="pattern-head">
          <PersonViewer look={avatar.person?.look} name={displayName(avatar)} className="dossier-person" />
          <div>
            <span className="rc-tag">{avatar.origin === "library" ? "Fictional" : "Yours"} · simulated</span>
            <h3>{displayName(avatar)}</h3>
            {avatar.person?.name && <p className="role">{avatar.name}</p>}
          </div>
        </header>
        <p className="summary">{avatar.summary}</p>

        <div className="profile-row">
          <Glyph scores={science.dimensions.map((d) => avatar.dimensions[d.id].value)} size={150} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
        </div>
        <h4 className="label">Eight tendencies · 0–10 · click one to see its brain map</h4>
        <div className="scales">
          {science.dimensions.map((d) => (
            <ScaleRow
              key={d.id}
              name={d.name}
              value={avatar.dimensions[d.id].value}
              low={d.low_pole}
              high={d.high_pole}
              title={d.definition}
              active={focus === d.id}
              onClick={() => onFocus(focus === d.id ? null : d.id)}
            />
          ))}
        </div>

        {(avatar.personality || avatar.context || avatar.voice) && (
          <details className="more">
            <summary>Personality, values and situation</summary>
            {avatar.personality && (
              <>
                <div className="scales">
                  {science.personality.traits.map((t) => (
                    <ScaleRow key={t.id} name={t.name} value={avatar.personality!.traits[t.id].value} low={t.low_pole} high={t.high_pole} title={t.definition} />
                  ))}
                </div>
                {avatar.personality.values.length > 0 && (
                  <div className="values-list">
                    {avatar.personality.values.map((v) => (
                      <span key={v} className="value-chip" title={values.get(v)?.definition}>
                        {values.get(v)?.name}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
            <dl className="facts-list situation">
              {avatar.context?.goals.length ? (
                <>
                  <dt>Goals</dt>
                  <dd>{avatar.context.goals.join("; ")}</dd>
                </>
              ) : null}
              {avatar.context?.constraints.length ? (
                <>
                  <dt>Constraints</dt>
                  <dd>{avatar.context.constraints.join("; ")}</dd>
                </>
              ) : null}
              {avatar.priorities.length ? (
                <>
                  <dt>Priorities</dt>
                  <dd>{avatar.priorities.join(", ")}</dd>
                </>
              ) : null}
              {avatar.voice && (
                <>
                  <dt>Voice</dt>
                  <dd>{avatar.voice}</dd>
                </>
              )}
            </dl>
          </details>
        )}

        <div className="pattern-actions">
          <button className="button" onClick={onEdit}>
            {avatar.origin === "user" ? "Edit" : "Make a variant"}
          </button>
          {onDelete && (
            <button className="button quiet danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="dossier-brain">
        <div className="brain-box">{brain}</div>
        <p className="note">
          {focused ? (
            <>
              <strong>{focused.name}.</strong> {focused.construct_map.note} Click it again for the whole pattern.
            </>
          ) : (
            <>
              <strong>Where this pattern's tendencies are studied.</strong> Published brain maps of the eight tendencies, weighted by how far
              this pattern departs from average. It shows research on the average brain, not this person's brain.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

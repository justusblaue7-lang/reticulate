import { useState } from "react";
import { api } from "../api";
import type { Atlas } from "../atlas/load";
import { emphasisOverlay, useConstructMaps } from "../brain/emphasis";
import type { BrainRenderer } from "../brain/renderer";
import { AvatarBuilder, blankAvatar } from "../components/AvatarBuilder";
import { displayName, Face } from "../components/Face";
import { Glyph } from "../components/Glyph";
import { ScaleRow } from "../components/ScaleRow";
import { Specimen, type OverlaySpec } from "../components/Specimen";
import { SourceSwitch } from "./AtlasView";
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

export function Medallion({ avatar, size = 92, on, onClick }: { avatar: Avatar; size?: number; on?: boolean; onClick?: () => void }) {
  return (
    <button className={`medallion ${on ? "on" : ""}`} onClick={onClick} title={avatar.summary}>
      <Face avatar={avatar} size={size} />
      <span>
        {displayName(avatar)}
        {avatar.person?.name && <small>{avatar.name}</small>}
      </span>
    </button>
  );
}

export function AvatarsView({ atlas, science, renderer, avatars, onAvatars }: Props) {
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
  const library = avatars.filter((a) => a.origin === "library");
  const own = avatars.filter((a) => a.origin === "user");

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
    <main className="view">
      <div className="avatars-view">
        <aside className="gallery">
          <h3 className="label" style={{ marginTop: 0 }}>Library · fictional people</h3>
          <div className="gallery-grid">
            {library.map((a) => (
              <Medallion key={a.id} avatar={a} size={78} on={!draft && a.id === selected?.id} onClick={() => { setDraft(null); setFocus(null); setSelectedId(a.id); }} />
            ))}
          </div>
          {own.length > 0 && (
            <>
              <h3 className="label">Your avatars</h3>
              <div className="gallery-grid">
                {own.map((a) => (
                  <Medallion key={a.id} avatar={a} size={78} on={!draft && a.id === selected?.id} onClick={() => { setDraft(null); setFocus(null); setSelectedId(a.id); }} />
                ))}
              </div>
            </>
          )}
          <button className="button new-avatar" onClick={() => { setFocus(null); setDraft(blankAvatar(science)); }}>
            New avatar
          </button>
        </aside>

        <section>
          {draft ? (
            <AvatarBuilder
              science={science}
              draft={draft}
              onChange={setDraft}
              onSave={save}
              onCancel={() => setDraft(null)}
              saving={saving}
              error={error}
              brain={brain(true)}
            />
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
        </section>
      </div>
    </main>
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
  return (
    <article>
      <header className="avatar-head">
        <PersonViewer look={avatar.person?.look} name={displayName(avatar)} className="dossier-person" />
        <div>
          <div className="label">{avatar.origin === "library" ? "Fictional person" : "Your avatar"} · a simulated decision-maker, not a real person</div>
          <h1 className="display">{displayName(avatar)}</h1>
          {avatar.person?.name && <p className="role">{avatar.name}</p>}
          <p className="summary">{avatar.summary}</p>
          {avatar.nuance && <p className="nuance">{avatar.nuance}</p>}
          <div className="avatar-actions">
            <button className="button" onClick={onEdit}>
              {avatar.origin === "user" ? "Edit" : "Make a variant"}
            </button>
            {onDelete && (
              <button className="button" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="avatar-body">
        <div>
          <section>
            <h3 className="label">Decision profile · 0–10, authored</h3>
            <div className="profile-figure">
              <Glyph scores={science.dimensions.map((d) => avatar.dimensions[d.id].value)} size={150} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
            </div>
            <div className="scales">
              {science.dimensions.map((d) => (
                <ScaleRow
                  key={d.id}
                  name={d.name}
                  value={avatar.dimensions[d.id].value}
                  low={d.low_pole}
                  high={d.high_pole}
                  title={`${d.definition} Click to show its construct map.`}
                  active={focus === d.id}
                  onClick={() => onFocus(focus === d.id ? null : d.id)}
                />
              ))}
            </div>
          </section>

          {avatar.personality && (
            <section>
              <h3 className="label">Personality · Big Five, 5 = average</h3>
              <div className="scales">
                {science.personality.traits.map((t) => (
                  <ScaleRow key={t.id} name={t.name} value={avatar.personality!.traits[t.id].value} low={t.low_pole} high={t.high_pole} title={t.definition} />
                ))}
              </div>
              {avatar.personality.values.length > 0 && (
                <>
                  <h3 className="label" style={{ marginTop: 22 }}>Values that matter most</h3>
                  <div className="values-list">
                    {avatar.personality.values.map((v) => (
                      <span key={v} className="value-chip" title={values.get(v)?.definition}>
                        {values.get(v)?.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          <section>
            <h3 className="label">Situation</h3>
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
          </section>
        </div>

        <div>
          <section>
            <h3 className="label">On the brain</h3>
            <div className="brain-box">{brain}</div>
            <p className="note" style={{ marginTop: 10 }}>
              {focus ? (
                <>
                  <strong>{science.dimensions.find((d) => d.id === focus)?.name}.</strong> {science.dimensions.find((d) => d.id === focus)?.construct_map.note} Click
                  the name again to return to the composite.
                </>
              ) : (
                <>
                  <strong>Construct emphasis.</strong> The construct maps of the eight dimensions, each weighted by how far this profile
                  departs from the midpoint. It shows where the constructs that set the profile apart are processed in the average
                  brain, not this person's brain activity, and it is blind to the direction of a leaning. Personality has no map, and
                  the portrait never enters a simulation.
                </>
              )}
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}

import { useState } from "react";
import { api } from "../api";
import { AvatarBuilder, blankAvatar } from "../components/AvatarBuilder";
import { Attitudes } from "../components/decision/Minds";
import { displayName, Face } from "../components/Face";
import { Glyph } from "../components/Glyph";
import { ScaleRow } from "../components/ScaleRow";
import { SHORT } from "../format";
import { PersonViewer } from "../people/PersonViewer";
import type { Avatar, Science } from "../types";

interface Props {
  science: Science;
  avatars: Avatar[];
  onAvatars: (avatars: Avatar[]) => void;
  onAtlas: () => void;
}

/** Other minds: simulated decision-makers, each a whole set of attitudes. */
export function Patterns({ science, avatars, onAvatars, onAtlas }: Props) {
  const [selectedId, setSelectedId] = useState<string>(avatars[0]?.id ?? "");
  const [draft, setDraft] = useState<Avatar | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = avatars.find((a) => a.id === selectedId) ?? avatars[0];

  const pick = (a: Avatar) => {
    setDraft(null);
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
        <button className={`pattern-chip add ${draft?.id === "new" ? "on" : ""}`} onClick={() => setDraft(blankAvatar(science))}>
          <span className="plus">+</span>
          <span>Build your own</span>
        </button>
      </div>

      <div className="card pattern-card">
        {draft ? (
          <AvatarBuilder science={science} draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} error={error} />
        ) : selected ? (
          <Dossier
            science={science}
            avatar={selected}
            onAtlas={onAtlas}
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

function Dossier({ science, avatar, onAtlas, onEdit, onDelete }: {
  science: Science;
  avatar: Avatar;
  onAtlas: () => void;
  onEdit: () => void;
  onDelete: (() => void) | null;
}) {
  const values = new Map(science.personality.values.map((v) => [v.id, v]));
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
        <div className="attitudes">
          <Attitudes science={science} avatar={avatar} limit={8} />
        </div>
        <div className="profile-row">
          <Glyph scores={science.dimensions.map((d) => avatar.dimensions[d.id].value)} size={150} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
        </div>
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

      <div className="dossier-attitudes">
        <section>
          <h4 className="label">How this mind decides · 0–10</h4>
          <div className="scales">
            {science.dimensions.map((d) => (
              <ScaleRow key={d.id} name={d.name} value={avatar.dimensions[d.id].value} low={d.low_pole} high={d.high_pole} title={d.definition} />
            ))}
          </div>
        </section>

        {avatar.personality && (
          <section>
            <h4 className="label">Personality · Big Five, 5 = average</h4>
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
          </section>
        )}

        {(avatar.context?.goals.length || avatar.context?.constraints.length || avatar.priorities.length || avatar.voice) ? (
          <section>
            <h4 className="label">Situation</h4>
            <dl className="facts-list situation">
              {avatar.context?.goals.length ? (
                <>
                  <dt>Wants</dt>
                  <dd>{avatar.context.goals.join("; ")}</dd>
                </>
              ) : null}
              {avatar.context?.constraints.length ? (
                <>
                  <dt>Bound by</dt>
                  <dd>{avatar.context.constraints.join("; ")}</dd>
                </>
              ) : null}
              {avatar.priorities.length ? (
                <>
                  <dt>Puts first</dt>
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
        ) : null}

        <p className="note">
          Attitudes are this character's answers to the six questions of the Global Preferences Survey, written by hand, not measured; the mind is simulated by Claude and predicts no real person.{" "}
          <button className="text-button" onClick={onAtlas}>
            The imaging literature on decision-making: the brain atlas
          </button>
        </p>
      </div>
    </div>
  );
}

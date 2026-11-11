import { useEffect, useState } from "react";
import { loadVocabulary, searchTerms, type MapEntry, type Vocabulary } from "../atlas/load";
import type { Science } from "../types";

interface Props {
  science: Science;
  maps: MapEntry[];
  selected: string | null; // curated map id, or "text"
  textQuery: string | null;
  literature: boolean; // engine can compute maps for any text
  onSelect: (id: string) => void;
  onText: (text: string) => Promise<void>;
}

const marks = (entry: MapEntry) => [entry.sources.neuroquery && "NQ", entry.sources.neurosynth && "NS"].filter(Boolean).join(" · ");

export function MapBrowser({ science, maps, selected, textQuery, literature, onSelect, onText }: Props) {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void loadVocabulary().then(setVocab), []);

  const byId = new Map(maps.map((m) => [m.id, m]));
  const suggestions = vocab && focus ? searchTerms(vocab, query) : [];

  const submit = async (text: string) => {
    if (text.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setFocus(false);
    try {
      await onText(text.trim());
      setQuery(text.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const item = (id: string, label: string) => {
    const entry = byId.get(id);
    if (!entry) return null;
    return (
      <button key={id} className={selected === id ? "on" : ""} onClick={() => onSelect(id)}>
        <span>{label}</span>
        <span className="sources-mark">{marks(entry)}</span>
      </button>
    );
  };

  return (
    <div className="maps">
      <form
        className="term-search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(query);
        }}
      >
        <input
          className="field"
          placeholder={literature ? "Any term or phrase, e.g. regret, social pain" : "Needs the engine with NeuroQuery"}
          value={query}
          disabled={!literature || busy}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
        />
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s.term} type="button" onMouseDown={() => void submit(s.term)}>
                <span>{s.term}</span>
                <span className="sources-mark">{[s.nq && "NQ", s.ns && "NS"].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </form>
      {vocab && (
        <p className="note" style={{ marginTop: 8 }}>
          {vocab.neuroquery.terms.length.toLocaleString()} NeuroQuery and {vocab.neurosynth.terms.length.toLocaleString()} Neurosynth
          terms. Free text is mapped by NeuroQuery; Neurosynth adds its map when the text is one of its terms.
        </p>
      )}
      {busy && <p className="status-line"><span className="spinner" /> Mapping “{query}”…</p>}
      {error && <p className="error">{error}</p>}
      {selected === "text" && textQuery && (
        <div className="map-list" style={{ marginTop: 10 }}>
          <button className="on">
            <span>“{textQuery}”</span>
            <span className="sources-mark">search</span>
          </button>
        </div>
      )}

      <section>
        <h3 className="label">Decision features</h3>
        <div className="map-list">{science.features.map((f) => item(`feature.${f.id}`, f.name))}</div>
      </section>
      {science.stimulus_categories.map((c) => (
        <section key={c.id}>
          <h3 className="label">{c.name}</h3>
          <div className="map-list">{science.stimuli.filter((s) => s.category === c.id).map((s) => item(`stimulus.${s.id}`, s.name))}</div>
        </section>
      ))}
      <section>
        <h3 className="label">Profile constructs</h3>
        <div className="map-list">{science.dimensions.map((d) => item(`construct.${d.id}`, d.name))}</div>
      </section>
    </div>
  );
}

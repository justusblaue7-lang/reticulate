import { useMemo, useState } from "react";
import type { Atlas } from "../atlas/load";
import type { Science } from "../types";

interface Props {
  atlas: Atlas;
  science: Science;
  selected: number;
  onPick: (code: number) => void;
}

export function StructureIndex({ atlas, science, selected, onPick }: Props) {
  const [query, setQuery] = useState("");
  const codes = useMemo(() => {
    const byId = new Map<string, Partial<Record<"lh" | "rh" | "mid", number>>>();
    atlas.geometry.regions.forEach((s, code) => {
      const entry = byId.get(s.id) ?? {};
      entry[s.hemi ?? "mid"] = code;
      byId.set(s.id, entry);
    });
    return byId;
  }, [atlas]);

  const q = query.trim().toLowerCase();
  const matches = (r: Science["regions"][number]) =>
    !q || [r.name, r.alias, ...r.functions].some((text) => text.toLowerCase().includes(q));

  return (
    <nav className="index" aria-label="Structure index">
      <input
        className="field"
        type="search"
        placeholder="Find a structure or function…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {science.region_groups.map((g) => {
        const regions = science.regions.filter((r) => r.group === g.id && matches(r));
        if (!regions.length) return null;
        return (
          <section key={g.id}>
            <h3 className="label">{g.name}</h3>
            <ul>
              {regions.map((r) => {
                const entry = codes.get(r.id) ?? {};
                const sides = (["lh", "rh", "mid"] as const).filter((k) => entry[k] !== undefined);
                const active = sides.some((k) => entry[k] === selected);
                return (
                  <li key={r.id} className={active ? "active" : ""}>
                    <button className="index-name" onClick={() => onPick(entry[sides[0]]!)}>
                      {r.name}
                    </button>
                    {sides.length > 1 && (
                      <span className="sides">
                        {sides.map((k) => (
                          <button
                            key={k}
                            className={entry[k] === selected ? "on" : ""}
                            onClick={() => onPick(entry[k]!)}
                            aria-label={`${r.name}, ${k === "lh" ? "left" : "right"}`}
                          >
                            {k === "lh" ? "L" : "R"}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export function RankedStructures({
  atlas,
  science,
  ranking,
  onPick,
  title,
}: {
  atlas: Atlas;
  science: Science;
  ranking: { key: string; z: number }[];
  onPick: (code: number) => void;
  title: string;
}) {
  const code = new Map(atlas.geometry.regions.map((s, i) => [s.key, i]));
  const names = new Map(science.regions.map((r) => [r.id, r.name]));
  const max = Math.max(...ranking.map((r) => r.z), 1);
  return (
    <section className="ranked">
      <h3 className="label">{title}</h3>
      <ol>
        {ranking.map((r) => {
          const s = atlas.geometry.regions[code.get(r.key)!];
          return (
            <li key={r.key}>
              <button onClick={() => onPick(code.get(r.key)!)}>
                <span className="ranked-name">
                  {names.get(s.id)}
                  {s.hemi && <span className="mono side"> {s.hemi === "lh" ? "L" : "R"}</span>}
                </span>
                <span className="hbar" style={{ width: `${(Math.max(0, r.z) / max) * 100}%` }} />
                <span className="mono num">{r.z.toFixed(1)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

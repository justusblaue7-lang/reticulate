import { useEffect, useState } from "react";
import { loadMap, percentile99, type Atlas } from "../atlas/load";
import type { OverlaySpec } from "../components/Specimen";
import { SOURCE_LABEL } from "../format";
import type { Avatar, Science, Source } from "../types";

/** Vertex maps of every dimension's construct in one source (dimensions it lacks are absent). */
export function useConstructMaps(atlas: Atlas | null, science: Science | null, source: Source) {
  const [maps, setMaps] = useState<Record<string, Float32Array> | null>(null);
  useEffect(() => {
    if (!atlas || !science) return;
    let current = true;
    const entries = science.dimensions
      .map((d) => atlas.catalogue.maps.find((m) => m.id === `construct.${d.id}`))
      .filter((m) => m && m.sources[source]);
    Promise.all(entries.map((e) => loadMap(atlas, e!, source))).then((loaded) => {
      if (current) setMaps(Object.fromEntries(entries.map((e, i) => [e!.ref, loaded[i]])));
    });
    return () => {
      current = false;
    };
  }, [atlas, science, source]);
  return maps;
}

/**
 * Construct emphasis: the construct maps, each weighted by how far the profile departs from the
 * midpoint on that dimension. Where in the average brain the constructs that set this profile
 * apart are processed; not this person's brain, and blind to the direction of a leaning.
 */
export function emphasisOverlay(
  science: Science,
  avatar: Avatar,
  maps: Record<string, Float32Array>,
  source: Source,
  threshold: number,
): OverlaySpec | null {
  const dims = science.dimensions.filter((d) => maps[d.id]);
  const weights = dims.map((d) => Math.abs(avatar.dimensions[d.id].value - 5) / 5);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!dims.length) return null;
  const n = maps[dims[0].id].length;
  const out = new Float32Array(n);
  if (total > 0) {
    dims.forEach((d, k) => {
      const w = weights[k] / total;
      if (!w) return;
      const map = maps[d.id];
      for (let i = 0; i < n; i++) if (map[i] > 0) out[i] += w * map[i];
    });
  }
  const missing = science.dimensions.length - dims.length;
  return {
    id: `emphasis.${source}.${avatar.id}.${science.dimensions.map((d) => avatar.dimensions[d.id].value).join("")}`,
    values: out,
    max: percentile99(out, threshold),
    title: `Construct emphasis · ${avatar.name}`,
    source: `${SOURCE_LABEL[source]} construct maps weighted by this authored profile's distance from the midpoint${missing ? ` (${missing} dimensions have no ${SOURCE_LABEL[source]} map)` : ""}`,
    unit: "weighted z",
    fire: 0,
  };
}

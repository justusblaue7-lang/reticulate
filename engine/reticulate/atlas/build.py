"""Build the atlas assets for the web client and the engine.

    python -m reticulate.atlas.build            # or: reticulate build-atlas

Outputs in web/public/atlas
    geometry.json + geometry.bin    surfaces, deep-structure meshes, labels, glass envelope
    regions.json                    per-structure statistics and construct overlap (both sources)
    vocabulary.json + decoding.bin  full-vocabulary decoding: the mean z in every structure for
                                    every NeuroQuery feature and every Neurosynth term, with
                                    Cognitive Atlas categories and cross-source agreement
    maps.json + maps/<id>.<src>.i8  curated maps (constructs, stimuli, decision features) from
                                    NeuroQuery (nq) and Neurosynth (ns)
Outputs in engine/.cache
    projector.npz                   grid -> atlas operator used at run time
    curated.npz                     grid z-vectors of the curated maps
    neurosynth_mkda_4mm.npz         Neurosynth study activation matrix

Inputs: fsaverage (mne.datasets.fetch_fsaverage), the NeuroQuery model, Neurosynth release 7,
the Cognitive Atlas and the curated YAML in reticulate/data. Missing downloads are fetched.
"""

import argparse
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from reticulate.atlas import geometry as geo
from reticulate.atlas.literature import (
    KERNEL_MM,
    TERM_THRESHOLD,
    Grid,
    NeuroQuerySource,
    NeurosynthSource,
    fdr_threshold,
    fetch_neuroquery,
    fetch_neurosynth,
)
from reticulate.atlas.maps import (
    CORTEX_DEPTHS,
    DISPLAY_THRESHOLD,
    QUANT_SCALE,
    build_projector,
    correlation,
    coverage,
    dice,
    display_max,
    quantised,
    to_mni152,
    top_structures,
)
from reticulate.atlas.vocabulary import CATEGORIES, CognitiveAtlas, categorise, fetch_cognitive_atlas
from reticulate.config import ENGINE_DIR
from reticulate.science import science

ATLAS_DIR = Path(os.getenv("RETICULATE_ATLAS_DIR", Path(__file__).resolve().parents[3] / "web" / "public" / "atlas"))
CACHE_DIR = Path(os.getenv("RETICULATE_CACHE_DIR", ENGINE_DIR / ".cache"))
VERSION = "0.3.0"
DECODING_SCALE = 100  # int16: z * 100
AGREEMENT_MIN_STUDIES = 50  # Neurosynth terms with fewer studies are too noisy to compare
CHUNK = 512


class BinaryWriter:
    def __init__(self) -> None:
        self.chunks: list[bytes] = []
        self.offset = 0
        self.entries: dict[str, dict] = {}

    def add(self, name: str, array: np.ndarray, dtype: str) -> str:
        data = np.ascontiguousarray(array, dtype=dtype).ravel()
        padding = (-self.offset) % 4
        if padding:
            self.chunks.append(b"\0" * padding)
            self.offset += padding
        self.entries[name] = {"dtype": dtype, "offset": self.offset, "length": int(data.size)}
        raw = data.tobytes()
        self.chunks.append(raw)
        self.offset += len(raw)
        return name

    def write(self, path: Path) -> None:
        path.write_bytes(b"".join(self.chunks))


def _view_for(hemi: str, normal: np.ndarray) -> str:
    axis = int(np.argmax(np.abs(normal)))
    if axis == 0:
        outward = normal[0] < 0 if hemi == "lh" else normal[0] > 0
        return f"{hemi}-{'lateral' if outward else 'medial'}"
    if axis == 1:
        return "anterior" if normal[1] > 0 else "posterior"
    return "dorsal" if normal[2] > 0 else "ventral"


def build_geometry(out: Path):
    """Writes geometry.json/.bin; returns what the map stages need."""
    sci = science()
    print("loading fsaverage …")
    cortex = geo.load_cortex()
    deep = geo.load_deep_meshes(sci.regions)

    surface_regions = [r for r in sci.regions if r.kind in ("cortex", "medialwall")]
    label_to_region = {str(label): r.id for r in surface_regions for label in r.atlas_labels}
    table: list[dict] = []
    for hemi in geo.HEMIS:
        for r in surface_regions:
            table.append({"key": f"{hemi}.{r.id}", "id": r.id, "hemi": hemi, "kind": r.kind})
    for mesh in deep:
        table.append({"key": mesh.key, "id": mesh.region, "hemi": mesh.hemi, "kind": "deep"})
    index_of = {entry["key"]: i for i, entry in enumerate(table)}

    writer = BinaryWriter()
    hemis_meta, cortex_keys, stats = {}, {}, {}
    for name, h in cortex.items():
        unknown = sorted(set(h.aparc) - set(label_to_region))
        if unknown:
            raise ValueError(f"{name}: aparc labels without a region: {unknown}")
        keys = np.array([f"{name}.{label_to_region[label]}" for label in h.aparc])
        cortex_keys[name] = keys
        codes = np.array([index_of[k] for k in keys])
        boundary = geo.boundary_vertices(h.faces, codes)
        hemis_meta[name] = {
            "vertices": len(h.pial),
            "faces": len(h.faces),
            "buffers": {
                "pial": writer.add(f"{name}.pial", h.pial, "float32"),
                "inflated": writer.add(f"{name}.inflated", h.inflated, "float32"),
                "index": writer.add(f"{name}.index", h.faces, "uint32"),
                "region": writer.add(f"{name}.region", codes, "uint8"),
                "network": writer.add(f"{name}.network", h.network, "uint8"),
                "sulc": writer.add(f"{name}.sulc", np.round(h.sulc * 127), "int8"),
                "boundary": writer.add(f"{name}.boundary", boundary, "uint8"),
            },
        }
        areas = geo.vertex_areas(h.pial, h.faces)
        normals = geo.vertex_normals(h.pial, h.faces)
        for key in np.unique(keys):
            members = np.flatnonzero(keys == key)
            centroid = h.pial[members].mean(axis=0)
            anchor = members[np.argmin(np.linalg.norm(h.pial[members] - centroid, axis=1))]
            nets = np.bincount(h.network[members], minlength=8)[1:]
            stats[str(key)] = {
                "vertices": int(len(members)),
                "area_cm2": round(float(areas[members].sum() / 100), 1),
                "centroid": [round(float(c), 1) for c in centroid],
                "anchor": int(anchor),
                "view": _view_for(name, normals[members].mean(axis=0)),
                "networks": {str(i + 1): round(float(n / len(members)), 3) for i, n in enumerate(nets) if n},
            }

    deep_meta, cursor = [], 0
    for mesh in deep:
        centroid = mesh.voxels.mean(axis=0)
        deep_meta.append(
            {
                "key": mesh.key,
                "region": index_of[mesh.key],
                "vertices": len(mesh.vertices),
                "faces": len(mesh.faces),
                "map_offset": cursor,
                "buffers": {
                    "position": writer.add(f"deep.{mesh.key}.position", mesh.vertices, "float32"),
                    "index": writer.add(f"deep.{mesh.key}.index", mesh.faces, "uint32"),
                },
            }
        )
        cursor += len(mesh.vertices)
        stats[mesh.key] = {
            "vertices": len(mesh.vertices),
            "volume_cm3": round(len(mesh.voxels) / 1000, 2),
            "centroid": [round(float(c), 1) for c in centroid],
            "anchor": int(np.argmin(np.linalg.norm(mesh.vertices - centroid, axis=1))),
            "view": "deep",
        }

    envelope_meta = {}
    for name, h in cortex.items():
        positions, faces = geo.envelope(h)
        envelope_meta[name] = {
            "position": writer.add(f"envelope.{name}.position", positions, "float32"),
            "index": writer.add(f"envelope.{name}.index", faces, "uint32"),
        }

    networks = []
    for n in sci.networks:
        r, g, b = cortex["lh"].network_colors[n.index]
        networks.append({"index": n.index, "id": n.id, "color": f"#{r:02x}{g:02x}{b:02x}"})

    writer.write(out / "geometry.bin")
    (out / "geometry.json").write_text(
        json.dumps(
            {
                "version": VERSION,
                "space": "fsaverage scanner RAS (MNI305), millimetres",
                "sources": {
                    "surfaces": "FreeSurfer fsaverage pial, white and inflated surfaces (Fischl et al., 1999)",
                    "parcellation": "Desikan–Killiany atlas, fsaverage aparc annotation (Desikan et al., 2006)",
                    "networks": "Yeo2011_7Networks_N1000 annotation (Yeo et al., 2011)",
                    "deep": "fsaverage aseg segmentation (Fischl et al., 2002), marching cubes, Taubin-smoothed",
                },
                "regions": table,
                "networks": networks,
                "hemispheres": hemis_meta,
                "deep": deep_meta,
                "envelope": envelope_meta,
                "buffers": writer.entries,
            },
            separators=(",", ":"),
        )
    )
    print(f"geometry: {writer.offset / 1e6:.1f} MB, {len(table)} structures")
    layout = {"lh": hemis_meta["lh"]["vertices"], "rh": hemis_meta["rh"]["vertices"], "deep": cursor}
    return table, cortex, deep, cortex_keys, stats, layout


def _link(nq: NeuroQuerySource, ns: NeurosynthSource) -> tuple[np.ndarray, np.ndarray]:
    """Cross-references: NeuroQuery feature -> Neurosynth term and back (-1 when absent)."""
    nq_to_ns = np.full(len(nq.features), -1)
    ns_to_nq = np.full(len(ns.vocabulary), -1)
    for j, term in enumerate(ns.vocabulary):
        i = nq.index(term)
        if i is not None:
            ns_to_nq[j] = i
    for j, term in enumerate(ns.vocabulary):  # exact names first, then plurals and synonyms
        i = ns_to_nq[j]
        if i >= 0 and nq.features[i] == term:
            nq_to_ns[i] = j
    for j in range(len(ns.vocabulary)):
        i = ns_to_nq[j]
        if i >= 0 and nq_to_ns[i] < 0:
            nq_to_ns[i] = j
    return nq_to_ns, ns_to_nq


def build_vocabulary(out: Path, nq: NeuroQuerySource, ns: NeurosynthSource, projector) -> dict:
    """Decode every term in both sources; returns the agreement summary."""
    atlas = CognitiveAtlas(fetch_cognitive_atlas())
    codes = {c: i for i, c in enumerate(CATEGORIES)}
    nq_to_ns, ns_to_nq = _link(nq, ns)

    started = time.time()
    nq_means = np.zeros((len(nq.features), len(projector.keys)), dtype=np.float32)
    agreement = np.full(len(nq.features), np.nan, dtype=np.float32)
    for start in range(0, len(nq.features), CHUNK):
        idx = np.arange(start, min(start + CHUNK, len(nq.features)))
        z = nq.feature_maps(idx)
        nq_means[idx] = projector.structure_means(z)
        linked = [k for k, i in enumerate(idx) if nq_to_ns[i] >= 0 and ns.term_counts[nq_to_ns[i]] >= AGREEMENT_MIN_STUDIES]
        if linked:
            other = ns.term_maps(nq_to_ns[idx[linked]])
            for k, row in zip(linked, other):
                agreement[idx[k]] = correlation(z[k], row)
    print(f"NeuroQuery: {len(nq.features)} features decoded in {time.time() - started:.0f}s")

    started = time.time()
    ns_means = np.zeros((len(ns.vocabulary), len(projector.keys)), dtype=np.float32)
    ns_fdr = np.zeros(len(ns.vocabulary), dtype=np.float32)
    for start in range(0, len(ns.vocabulary), CHUNK):
        idx = np.arange(start, min(start + CHUNK, len(ns.vocabulary)))
        z = ns.term_maps(idx)
        ns_means[idx] = projector.structure_means(z)
        ns_fdr[idx] = [fdr_threshold(row) or np.nan for row in z]
    print(f"Neurosynth: {len(ns.vocabulary)} terms decoded in {time.time() - started:.0f}s")

    nq_cat = [categorise(t, atlas) for t in nq.features]
    ns_cat = [categorise(t, atlas) for t in ns.vocabulary]
    blob = np.concatenate(
        [
            np.clip(np.round(nq_means * DECODING_SCALE), -32768, 32767).astype(np.int16).ravel(),
            np.clip(np.round(ns_means * DECODING_SCALE), -32768, 32767).astype(np.int16).ravel(),
        ]
    )
    (out / "decoding.bin").write_bytes(blob.tobytes())
    valid = agreement[~np.isnan(agreement)]
    summary = {
        "terms": int(len(valid)),
        "median_r": round(float(np.median(valid)), 3) if len(valid) else None,
        "quartiles": [round(float(q), 3) for q in np.percentile(valid, [25, 75])] if len(valid) else None,
        "min_studies": AGREEMENT_MIN_STUDIES,
    }
    retrieved = datetime.fromtimestamp((fetch_cognitive_atlas() / "concept.json").stat().st_mtime, UTC)
    (out / "vocabulary.json").write_text(
        json.dumps(
            {
                "version": VERSION,
                "structures": projector.keys,
                "scale": DECODING_SCALE,
                "categories": list(CATEGORIES.items()),
                "cognitive_atlas": {"retrieved": retrieved.date().isoformat(), "entries": len(atlas.entries)},
                "agreement": summary,
                "neuroquery": {
                    "offset": 0,
                    "terms": nq.features,
                    "documents": nq.documents.astype(int).tolist(),
                    "category": [codes[c] for c, _, _ in nq_cat],
                    "atlas": [name for _, _, name in nq_cat],
                    "link": nq_to_ns.astype(int).tolist(),
                    "agreement": [None if np.isnan(r) else round(float(r), 3) for r in agreement],
                },
                "neurosynth": {
                    "offset": int(nq_means.size),
                    "terms": ns.vocabulary,
                    "studies": ns.term_counts.astype(int).tolist(),
                    "category": [codes[c] for c, _, _ in ns_cat],
                    "atlas": [name for _, _, name in ns_cat],
                    "link": ns_to_nq.astype(int).tolist(),
                    "fdr_z": [None if np.isnan(v) else round(float(v), 2) for v in ns_fdr],
                },
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )
    counts = {c: sum(1 for x, _, _ in nq_cat if x == c) for c in CATEGORIES}
    print(f"vocabulary: NeuroQuery categories {counts}; agreement over {summary['terms']} shared terms, median r {summary['median_r']}")
    return summary


def curated_maps(nq: NeuroQuerySource, ns: NeurosynthSource) -> list[dict]:
    """Every curated map: (id, kind, ref, name, NeuroQuery query, Neurosynth terms)."""
    sci = science()
    items = [
        {"id": f"construct.{d.id}", "kind": "construct", "ref": d.id, "name": d.name, "query": d.construct_map.query, "terms": d.construct_map.neurosynth}
        for d in sci.dimensions
    ]
    items += [
        {"id": f"stimulus.{s.id}", "kind": "stimulus", "ref": s.id, "name": s.name, "query": s.query, "terms": s.neurosynth}
        for s in sci.stimuli
    ]
    items += [
        {"id": f"feature.{f.id}", "kind": "feature", "ref": f.id, "name": f.name, "query": f.neuroquery, "terms": f.neurosynth}
        for f in sci.features
        if f.neuroquery or f.neurosynth
    ]
    for item in items:
        missing = [t for t in item["terms"] if ns.index(t) is None]
        if missing:
            raise ValueError(f"{item['id']}: not in the Neurosynth vocabulary: {missing}")
    return items


def build_maps(out: Path, nq, ns, projector, layout: dict, agreement: dict) -> None:
    (out / "maps").mkdir(exist_ok=True)
    for old in (out / "maps").glob("*.i8"):
        old.unlink()
    n_cortex = layout["lh"] + layout["rh"]
    medial = {k for k in projector.keys if k.endswith("medialwall")}
    items = curated_maps(nq, ns)
    grids: dict[str, np.ndarray] = {}
    entries = []
    for item in items:
        sources = {}
        if item["query"]:
            z, terms = nq.query(item["query"])
            grids[f"{item['id']}.nq"] = z
            sources["neuroquery"] = {"query": item["query"], **terms}
        if item["terms"]:
            selected = ns.studies([ns.index(t) for t in item["terms"]])
            z = ns.association(selected)
            grids[f"{item['id']}.ns"] = z
            sources["neurosynth"] = {"terms": item["terms"], "studies": int(selected.sum()), "fdr_z": fdr_threshold(z)}
        for source, short in (("neuroquery", "nq"), ("neurosynth", "ns")):
            if source not in sources:
                continue
            z = grids[f"{item['id']}.{short}"]
            values = projector.vertex_values(z)
            file = f"maps/{item['id']}.{short}.i8"
            (out / file).write_bytes(quantised(values))
            means = projector.structure_means(z)
            sources[source].update(
                file=file,
                display_max=round(display_max(values), 2),
                coverage=round(coverage(values, n_cortex), 4),
                top_regions=top_structures(means, projector.keys, skip=medial),
                constructs=None,
            )
        entry = {k: item[k] for k in ("id", "kind", "ref", "name")} | {"sources": sources}
        if "neuroquery" in sources and "neurosynth" in sources:
            a, b = grids[f"{item['id']}.nq"], grids[f"{item['id']}.ns"]
            entry["agreement"] = {"r": round(correlation(a, b), 3), "dice": dice(a, b)}
        entries.append(entry)
    # Overlap of stimuli and decision features with each construct, within each source.
    for entry in entries:
        if entry["kind"] == "construct":
            continue
        for source, short in (("neuroquery", "nq"), ("neurosynth", "ns")):
            if source not in entry["sources"]:
                continue
            z = grids[f"{entry['id']}.{short}"]
            entry["sources"][source]["constructs"] = {
                d.id: round(correlation(z, grids[f"construct.{d.id}.{short}"]), 3)
                for d in science().dimensions
                if f"construct.{d.id}.{short}" in grids
            }
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE_DIR / "curated.npz", **grids)
    (out / "maps.json").write_text(
        json.dumps(
            {
                "version": VERSION,
                "generated": datetime.now(UTC).isoformat(timespec="seconds"),
                "threshold": DISPLAY_THRESHOLD,
                "quant_scale": QUANT_SCALE,
                "layout": layout,
                "grid": "NeuroQuery brain mask, 4-mm MNI152, 28,542 voxels",
                "sources": {
                    "neuroquery": {
                        "name": "NeuroQuery",
                        "citation": "dockes2020",
                        "documents": int(nq.n_documents),
                        "terms": 7547,
                        "features": len(nq.features),
                        "method": "Text-to-brain model trained on full-text articles; z-maps from its reduced-rank ridge regression after semantic smoothing.",
                    },
                    "neurosynth": {
                        "name": "Neurosynth",
                        "citation": "yarkoni2011",
                        "release": 7,
                        "studies": int(ns.n_studies),
                        "peaks": int(ns.n_peaks),
                        "terms": len(ns.vocabulary),
                        "method": f"Association test: two-way chi-square between term use (abstract tf-idf ≥ {TERM_THRESHOLD}) and activation within {KERNEL_MM:g} mm of a reported peak, as z.",
                    },
                },
                "agreement": agreement,
                "maps": entries,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )
    with_both = sum(1 for e in entries if "agreement" in e)
    print(f"maps: {len(entries)} curated, {with_both} with both sources")


def build_regions(out: Path, table: list[dict], stats: dict, projector) -> None:
    grids = np.load(CACHE_DIR / "curated.npz")
    constructs = {}
    for source, short in (("neuroquery", "nq"), ("neurosynth", "ns")):
        constructs[source] = {}
        for d in science().dimensions:
            key = f"construct.{d.id}.{short}"
            if key in grids:
                constructs[source][d.id] = projector.structure_means(grids[key])
    index = {k: i for i, k in enumerate(projector.keys)}
    regions_out = []
    for entry in table:
        i = index[entry["key"]]
        regions_out.append(
            {
                **entry,
                **stats[entry["key"]],
                "constructs": {
                    source: {d: round(float(means[i]), 2) for d, means in by_dim.items()}
                    for source, by_dim in constructs.items()
                },
            }
        )
    (out / "regions.json").write_text(json.dumps({"version": VERSION, "regions": regions_out}, separators=(",", ":")))


def check_projector(grid: Grid, projector, cortex, nq: NeuroQuerySource) -> None:
    """The operator must equal direct trilinear sampling of the volume (checked on 2,000 vertices)."""
    from scipy import ndimage

    z = nq.feature_maps(np.array([nq.index("reward")]))[0]
    volume = np.zeros(grid.mask.shape)
    volume[grid.mask] = z
    h = cortex["lh"]
    vertices = np.random.default_rng(0).choice(len(h.pial), 2000, replace=False)
    inverse = np.linalg.inv(grid.affine)
    samples = []
    for f in CORTEX_DEPTHS:
        points = to_mni152(h.white[vertices] + f * (h.pial[vertices] - h.white[vertices]))
        ijk = (inverse @ np.c_[points, np.ones(len(points))].T)[:3]
        samples.append(ndimage.map_coordinates(volume, ijk, order=1, mode="constant", cval=0.0))
    error = float(np.abs(np.mean(samples, axis=0) - projector.vertex_values(z)[vertices]).max())
    if error > 1e-3:
        raise AssertionError(f"projector deviates from direct sampling by {error}")
    print(f"projector: {projector.vertices.nnz / 1e6:.1f}M weights, max deviation from direct sampling {error:.1e}")


def build(out: Path = ATLAS_DIR) -> None:
    started = time.time()
    out.mkdir(parents=True, exist_ok=True)
    table, cortex, deep, cortex_keys, stats, layout = build_geometry(out)

    print("projecting the grid onto the atlas …")
    fetch_neuroquery()
    grid = Grid.load()
    nq = NeuroQuerySource(grid)
    projector = build_projector(grid, cortex, deep, cortex_keys, [e["key"] for e in table])
    check_projector(grid, projector, cortex, nq)
    projector.save(CACHE_DIR / "projector.npz")

    print("loading Neurosynth …")
    fetch_neurosynth()
    ns = NeurosynthSource(grid, cache=CACHE_DIR / "neurosynth_mkda_4mm.npz")

    agreement = build_vocabulary(out, nq, ns, projector)
    build_maps(out, nq, ns, projector, layout, agreement)
    build_regions(out, table, stats, projector)
    print(f"done in {time.time() - started:.0f}s → {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ATLAS_DIR)
    build(parser.parse_args().out)


if __name__ == "__main__":
    main()

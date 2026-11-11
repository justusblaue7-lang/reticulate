"""Meta-analytic maps at run time.

Loads what `reticulate build-atlas` produced (the grid operator, the curated maps, the
decoding matrices) together with both literature sources, and serves the map of any text
or vocabulary term and level-weighted composites such as a decision's neural signature.
Everything here is group-level literature: it says where studies of a topic report
activation, never how a particular brain responds.
"""

import base64
import json
import threading
from functools import cache

import numpy as np

from reticulate.atlas.build import ATLAS_DIR, CACHE_DIR
from reticulate.atlas.literature import Grid, NeuroQuerySource, NeurosynthSource, Projector, fdr_threshold
from reticulate.atlas.maps import DISPLAY_THRESHOLD, correlation, coverage, dice, display_max, quantised, top_structures
from reticulate.science import science

SOURCES = {"neuroquery": "nq", "neurosynth": "ns"}
FUNCTIONAL = ("concept", "task")  # Cognitive Atlas categories used for decoding
MIN_EVIDENCE = 50  # documents (NeuroQuery) or studies (Neurosynth) for a term to decode
_lock = threading.Lock()


class AtlasUnavailable(RuntimeError):
    pass


def available() -> bool:
    try:
        import neuroquery  # noqa: F401
    except ImportError:
        return False
    files = [CACHE_DIR / f for f in ("projector.npz", "curated.npz", "neurosynth_mkda_4mm.npz")]
    return all(f.exists() for f in files) and (ATLAS_DIR / "vocabulary.json").exists()


class Literature:
    def __init__(self) -> None:
        if not available():
            raise AtlasUnavailable("atlas assets or NeuroQuery are missing; run `reticulate build-atlas`")
        self.grid = Grid.load()
        self.projector = Projector.load(CACHE_DIR / "projector.npz")
        self.nq = NeuroQuerySource(self.grid)
        self.ns = NeurosynthSource(self.grid, cache=CACHE_DIR / "neurosynth_mkda_4mm.npz")
        with np.load(CACHE_DIR / "curated.npz") as f:
            self.curated = {k: f[k] for k in f.files}
        catalogue = json.loads((ATLAS_DIR / "maps.json").read_text(encoding="utf-8"))
        self.layout = catalogue["layout"]
        self.n_cortex = self.layout["lh"] + self.layout["rh"]
        self.skip = {k for k in self.projector.keys if k.endswith("medialwall")}
        self._load_networks()
        self._load_decoding()

    def _load_networks(self) -> None:
        geometry = json.loads((ATLAS_DIR / "geometry.json").read_text(encoding="utf-8"))
        blob = (ATLAS_DIR / "geometry.bin").read_bytes()
        parts = []
        for hemi in ("lh", "rh"):
            entry = geometry["buffers"][geometry["hemispheres"][hemi]["buffers"]["network"]]
            parts.append(np.frombuffer(blob, dtype=np.uint8, count=entry["length"], offset=entry["offset"]))
        self.network = np.concatenate(parts)  # Yeo-7 index per cortical vertex, 0 = medial wall
        self.network_ids = {n["index"]: n["id"] for n in geometry["networks"]}

    def _load_decoding(self) -> None:
        """Standardised grid maps of the functional terms with enough evidence, for decoding."""
        vocabulary = json.loads((ATLAS_DIR / "vocabulary.json").read_text(encoding="utf-8"))
        categories = [c for c, _ in vocabulary["categories"]]
        self.decoding = {}
        for source in SOURCES:
            table = vocabulary[source]
            evidence = table["documents"] if source == "neuroquery" else table["studies"]
            usable = np.array(
                [i for i, (c, e) in enumerate(zip(table["category"], evidence)) if categories[c] in FUNCTIONAL and e >= MIN_EVIDENCE]
            )
            maps = self.nq.feature_maps(usable) if source == "neuroquery" else self.ns.term_maps(usable)
            maps -= maps.mean(axis=1, keepdims=True)
            maps /= np.maximum(maps.std(axis=1, keepdims=True), 1e-9)
            self.decoding[source] = (np.asarray(table["terms"])[usable], maps)

    # ---- description of a map ---------------------------------------------------------

    def networks(self, values: np.ndarray) -> dict[str, float]:
        """Share of suprathreshold cortex in each Yeo network."""
        cortex = values[: self.n_cortex]
        active = (cortex >= DISPLAY_THRESHOLD) & (self.network > 0)
        total = int(active.sum())
        if not total:
            return {}
        counts = np.bincount(self.network[active], minlength=8)
        return {self.network_ids[i]: round(float(counts[i] / total), 3) for i in range(1, 8) if counts[i]}

    def decode(self, z: np.ndarray, source: str, n: int = 8) -> list[dict]:
        """Functional terms (Cognitive Atlas concepts and tasks with at least MIN_EVIDENCE
        studies) whose maps in the same source correlate best with this one, over the grid."""
        terms, maps = self.decoding[source]
        x = (z - z.mean()) / (z.std() or 1)
        r = maps @ x / len(x)
        order = np.argsort(-r)[:n]
        return [{"term": str(terms[i]), "r": round(float(r[i]), 3)} for i in order]

    def constructs(self, z: np.ndarray, source: str) -> dict[str, float]:
        short = SOURCES[source]
        return {
            d.id: round(correlation(z, self.curated[f"construct.{d.id}.{short}"]), 3)
            for d in science().dimensions
            if f"construct.{d.id}.{short}" in self.curated
        }

    def describe(self, z: np.ndarray, source: str, values: bool = True) -> dict:
        vertex = self.projector.vertex_values(z)
        means = self.projector.structure_means(z)
        out = {
            "display_max": round(display_max(vertex), 2),
            "coverage": round(coverage(vertex, self.n_cortex), 4),
            "top_regions": top_structures(means, self.projector.keys, skip=self.skip),
            "networks": self.networks(vertex),
            "constructs": self.constructs(z, source),
            "decoding": self.decode(z, source),
        }
        if values:
            out["values"] = base64.b64encode(quantised(vertex)).decode()
        return out

    # ---- maps -------------------------------------------------------------------------

    def text(self, text: str) -> dict:
        """NeuroQuery map of free text; Neurosynth map when the text is one of its terms."""
        text = text.strip()
        z_nq, terms = self.nq.query(text)
        if not terms["query_terms"]:
            raise ValueError("none of the words are in NeuroQuery's vocabulary; try standard neuroscience terms")
        result: dict = {
            "query": text,
            "neuroquery": {"query": text, **terms, **self.describe(z_nq, "neuroquery")},
            "neurosynth": None,
            "agreement": None,
        }
        j = self.ns.index(text)
        if j is None:
            feature = self.nq.index(text)
            linked = [k for k, term in enumerate(self.ns.vocabulary) if feature is not None and self.nq.index(term) == feature]
            j = linked[0] if linked else None
        if j is not None:
            z_ns = self.ns.term_maps(np.array([j]))[0]
            result["neurosynth"] = {
                "terms": [self.ns.vocabulary[j]],
                "studies": int(self.ns.term_counts[j]),
                "fdr_z": fdr_threshold(z_ns),
                **self.describe(z_ns, "neurosynth"),
            }
            result["agreement"] = {"r": round(correlation(z_nq, z_ns), 3), "dice": dice(z_nq, z_ns)}
        return result

    def composite(self, weights: dict[str, float]) -> dict:
        """Weighted mean of curated maps (ids like "feature.possible_loss"), per source.

        A weighted mean of z-maps is a descriptive composite, not itself a z-map. The two
        sources are compared only over the maps both of them have.
        """
        weights = {k: w for k, w in weights.items() if w > 0}
        out: dict = {"agreement": None}
        grids = {}
        for source, short in SOURCES.items():
            parts = [(w, self.curated[f"{k}.{short}"]) for k, w in weights.items() if f"{k}.{short}" in self.curated]
            if not parts:
                out[source] = None
                continue
            z = sum(w * g for w, g in parts) / sum(w for w, _ in parts)
            grids[source] = z
            out[source] = {"maps": len(parts), **self.describe(z, source, values=False)}
        shared = [k for k in weights if f"{k}.nq" in self.curated and f"{k}.ns" in self.curated]
        if shared:
            total = sum(weights[k] for k in shared)
            a = sum(weights[k] * self.curated[f"{k}.nq"] for k in shared) / total
            b = sum(weights[k] * self.curated[f"{k}.ns"] for k in shared) / total
            out["agreement"] = {"r": round(correlation(a, b), 3), "dice": dice(a, b), "maps": len(shared)}
        return out


@cache
def _literature() -> Literature:
    return Literature()


def literature() -> Literature:
    with _lock:  # loading and NeuroQuery's tokenizer are not thread-safe
        return _literature()


def warm() -> None:
    """Load the sources ahead of the first request (run in a background thread)."""
    try:
        literature()
    except Exception:  # noqa: BLE001 - a failed warm-up is reported on first use instead
        pass


def text_map(text: str) -> dict:
    lit = literature()
    with _lock:
        return lit.text(text)


def composite(weights: dict[str, float]) -> dict:
    lit = literature()
    with _lock:
        return lit.composite(weights)

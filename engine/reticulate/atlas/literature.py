"""The two meta-analytic literature sources, on one grid.

Both sources are expressed as z-maps over the voxels of NeuroQuery's 4-mm MNI152 brain
mask, so the two maps of a term can be compared voxel by voxel and projected onto the
atlas with one linear operator (`Projector`).

NeuroQuery (Dockès et al., 2020): a text-to-brain model trained on 13,459 full-text
articles. Its vocabulary has 7,547 terms; synonyms and plurals map onto 6,308 distinct
features. `NeuroQuerySource.feature_maps` computes feature maps in batch with the model's
own algebra (semantic smoothing, reduced-rank ridge regression, z-transform); the result
equals `NeuroQueryModel(term)["brain_map"]`, which the tests check.

Neurosynth (Yarkoni et al., 2011), release 7: 14,371 studies with their reported peaks and
3,228 abstract terms. Each study's activation map is a binary 10-mm sphere around each of
its peaks (the MKDA kernel; Wager et al., 2007). A term's map is the association test of
the original Neurosynth: a two-way chi-square test of independence between using the term
(tf-idf >= 0.001 in the abstract) and activating a voxel, signed by the direction of the
association and expressed as z. Peaks reported in Talairach space are converted to MNI with
the transform of Lancaster et al. (2007).
"""

import gzip
import itertools
import json
import os
import urllib.request
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import numpy as np
from scipy import sparse, special
from scipy.spatial import cKDTree

NEUROQUERY_DIR = Path(os.getenv("RETICULATE_NEUROQUERY", Path.home() / "neuroquery_data" / "neuroquery_model"))
NEUROSYNTH_DIR = Path(os.getenv("RETICULATE_NEUROSYNTH", Path.home() / "neurosynth_data" / "version-7"))
NEUROSYNTH_URL = "https://raw.githubusercontent.com/neurosynth/neurosynth-data/master/data-neurosynth_version-7_{}"
NEUROSYNTH_FILES = {
    "coordinates": "coordinates.tsv.gz",
    "metadata": "metadata.tsv.gz",
    "features": "vocab-terms_source-abstract_type-tfidf_features.npz",
    "vocabulary": "vocab-terms_vocabulary.txt",
}
KERNEL_MM = 10.0  # MKDA sphere radius
TERM_THRESHOLD = 0.001  # tf-idf at which a study counts as using a term (Neurosynth default)
Z_CAP = 33.0  # Neurosynth floors p at 1e-240, i.e. |z| <= 33.1
FDR_Q = 0.01

# Lancaster et al. (2007), tal2icbm "other": maps MNI to Talairach; inverted below.
ICBM_OTHER = np.array(
    [
        [0.9357, 0.0029, -0.0072, -1.0423],
        [-0.0065, 0.9396, -0.0726, -1.3940],
        [0.0103, 0.0752, 0.8967, 3.6475],
        [0.0, 0.0, 0.0, 1.0],
    ]
)


def tal_to_mni(points: np.ndarray) -> np.ndarray:
    return (np.linalg.inv(ICBM_OTHER) @ np.c_[points, np.ones(len(points))].T).T[:, :3]


# ---- grid and projection ------------------------------------------------------------------


@dataclass
class Grid:
    """NeuroQuery's brain mask: the voxels every map is defined on, in C order."""

    mask: np.ndarray  # (X, Y, Z) bool
    affine: np.ndarray  # voxel -> MNI152 mm

    @classmethod
    def load(cls, directory: Path = NEUROQUERY_DIR) -> "Grid":
        import nibabel as nib

        img = nib.load(str(directory / "mask_img.nii.gz"))
        return cls(np.asarray(img.dataobj).astype(bool), img.affine.astype(np.float64))

    @cached_property
    def size(self) -> int:
        return int(self.mask.sum())

    @cached_property
    def lookup(self) -> np.ndarray:
        """Flat grid index -> masked index, -1 outside the mask."""
        out = np.full(self.mask.size, -1, dtype=np.int64)
        out[np.flatnonzero(self.mask.ravel())] = np.arange(self.size)
        return out

    @cached_property
    def centres(self) -> np.ndarray:
        ijk = np.argwhere(self.mask)
        return (self.affine @ np.c_[ijk, np.ones(len(ijk))].T).T[:, :3]

    def masked(self, img) -> np.ndarray:
        """Masked vector of a volume on this grid."""
        if not np.allclose(img.affine, self.affine) or img.shape[:3] != self.mask.shape:
            raise ValueError("image is not on the NeuroQuery grid")
        return np.asarray(img.get_fdata(), dtype=np.float32)[self.mask]

    def trilinear(self, points: np.ndarray) -> sparse.csr_matrix:
        """(n_points x n_voxels) operator equal to trilinear sampling of the masked volume."""
        ijk = (np.linalg.inv(self.affine) @ np.c_[points, np.ones(len(points))].T)[:3].T
        base = np.floor(ijk).astype(np.int64)
        frac = ijk - base
        shape = np.array(self.mask.shape)
        rows, cols, vals = [], [], []
        for corner in itertools.product((0, 1), repeat=3):
            c = base + corner
            weight = np.prod(np.where(corner, frac, 1 - frac), axis=1)
            inside = np.all((c >= 0) & (c < shape), axis=1)
            masked = np.full(len(points), -1)
            masked[inside] = self.lookup[np.ravel_multi_index(c[inside].T, self.mask.shape)]
            keep = (masked >= 0) & (weight > 0)
            rows.append(np.flatnonzero(keep))
            cols.append(masked[keep])
            vals.append(weight[keep])
        matrix = sparse.coo_matrix(
            (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(len(points), self.size)
        )
        return matrix.tocsr().astype(np.float32)


@dataclass
class Projector:
    """Grid z-vectors -> atlas vertex values ([lh | rh | deep]) and structure means."""

    vertices: sparse.csr_matrix  # (n_layout, n_voxels)
    structures: sparse.csr_matrix  # (n_structures, n_voxels)
    keys: list[str]  # structure keys, in the order of geometry.json's region table

    def vertex_values(self, z: np.ndarray) -> np.ndarray:
        return np.asarray(self.vertices @ z, dtype=np.float32)

    def structure_means(self, z: np.ndarray) -> np.ndarray:
        """(n_structures,) for one map, (k, n_structures) for k maps given as rows."""
        return np.asarray(self.structures @ z.T, dtype=np.float32).T

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            **{f"v_{k}": getattr(self.vertices, k) for k in ("data", "indices", "indptr")},
            **{f"s_{k}": getattr(self.structures, k) for k in ("data", "indices", "indptr")},
            v_shape=self.vertices.shape,
            s_shape=self.structures.shape,
            keys=np.array(self.keys),
        )

    @classmethod
    def load(cls, path: Path) -> "Projector":
        with np.load(path, allow_pickle=False) as f:
            v = sparse.csr_matrix((f["v_data"], f["v_indices"], f["v_indptr"]), shape=tuple(f["v_shape"]))
            s = sparse.csr_matrix((f["s_data"], f["s_indices"], f["s_indptr"]), shape=tuple(f["s_shape"]))
            return cls(v, s, [str(k) for k in f["keys"]])


# ---- NeuroQuery ---------------------------------------------------------------------------


class NeuroQuerySource:
    name = "neuroquery"
    label = "NeuroQuery"

    def __init__(self, grid: Grid, directory: Path = NEUROQUERY_DIR):
        from neuroquery.tokenization import TextVectorizer

        self.grid = grid
        self.directory = directory
        regression = directory / "regression"
        self.coef = np.load(regression / "coef.npy")  # (voxels, supervised features)
        self.M = np.load(regression / "M.npy")  # (supervised features, training documents)
        self.residual_sd = np.sqrt(np.load(regression / "residual_var.npy"))
        self.selected = np.load(regression / "selected_features.npy")
        V = np.load(directory / "smoothing" / "V.npy")
        weight = float(np.load(directory / "smoothing" / "smoothing_weight.npy"))
        # As in neuroquery.nmf.CovarianceSmoothing.from_data_dir.
        norm = np.linalg.norm(V @ V.T, axis=1)
        zero = norm == 0
        norm[zero] = 1
        normalised = V / norm[:, None]
        normalised[zero] = 0
        # Smoothing of a one-hot query, restricted to the supervised features:
        # S[:, selected] = w · V̂ Vᵀ[:, selected] + (1 − w) · I[:, selected].
        smooth = weight * (normalised @ V[self.selected].T)
        smooth[self.selected, np.arange(len(self.selected))] += 1 - weight
        self.smoothing = smooth.astype(np.float32)  # (features, supervised features)

        vectorizer = TextVectorizer.from_vocabulary_file(
            str(directory / "vocabulary.csv"), voc_mapping="auto", add_unigrams=False
        )
        self.features: list[str] = [str(t) for t in vectorizer.get_vocabulary()]
        index = {t: i for i, t in enumerate(self.features)}
        mapping = json.loads((directory / "vocabulary.csv_voc_mapping_identity.json").read_text())
        self.aliases = {term: index[target] for term, target in mapping.items() if target in index}
        self.n_documents = self.M.shape[1]

    @cached_property
    def documents(self) -> np.ndarray:
        """Number of corpus articles that use each feature."""
        tfidf = sparse.load_npz(str(self.directory / "corpus_tfidf.npz"))
        return np.asarray((tfidf > 0).sum(axis=0)).ravel()

    def index(self, term: str) -> int | None:
        term = term.strip().lower()
        return self._index.get(term, self.aliases.get(term))

    @cached_property
    def _index(self) -> dict[str, int]:
        return {t: i for i, t in enumerate(self.features)}

    def feature_maps(self, features: np.ndarray) -> np.ndarray:
        """(k, voxels) z-maps of single features, exactly as the model computes them."""
        s = self.smoothing[np.asarray(features)]  # (k, supervised)
        scale = np.linalg.norm(s @ self.M, axis=1)  # sqrt(prediction variance) / residual sd
        z = (s @ self.coef.T) / np.maximum(scale[:, None] * self.residual_sd[None, :], 1e-24)
        return z.astype(np.float32)

    def query(self, text: str) -> tuple[np.ndarray, dict]:
        """z-map of free text (any combination of vocabulary terms) and the terms it used."""
        result = _neuroquery_model()(text)
        words = result["similar_words"]
        used = words[words["weight_in_query"] > 0].sort_values("weight_in_query", ascending=False)
        expanded = words.sort_values("weight_in_brain_map", ascending=False).head(8)
        return self.grid.masked(result["brain_map"]), {
            "query_terms": [str(t) for t in used.index],
            "map_terms": [
                {"term": str(t), "weight": round(float(w), 3)} for t, w in expanded["weight_in_brain_map"].items()
            ],
        }


_MODEL = None


def _neuroquery_model():
    global _MODEL
    if _MODEL is None:
        from neuroquery import NeuroQueryModel

        _MODEL = NeuroQueryModel.from_data_dir(str(NEUROQUERY_DIR))
    return _MODEL


def fetch_neuroquery() -> Path:
    """Download the NeuroQuery model once (to ~/neuroquery_data by default)."""
    from neuroquery import fetch_neuroquery_model

    return Path(fetch_neuroquery_model())


# ---- Neurosynth ---------------------------------------------------------------------------


def fetch_neurosynth(directory: Path = NEUROSYNTH_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name in NEUROSYNTH_FILES.values():
        path = directory / f"data-neurosynth_version-7_{name}"
        if not path.exists():
            print(f"downloading Neurosynth {name} …")
            urllib.request.urlretrieve(NEUROSYNTH_URL.format(name), path)
    return directory


def _read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        header = f.readline().rstrip("\n").split("\t")
        return header, [line.rstrip("\n").split("\t") for line in f]


class NeurosynthSource:
    name = "neurosynth"
    label = "Neurosynth"

    def __init__(self, grid: Grid, directory: Path = NEUROSYNTH_DIR, cache: Path | None = None):
        self.grid = grid
        file = lambda key: directory / f"data-neurosynth_version-7_{NEUROSYNTH_FILES[key]}"  # noqa: E731
        header, rows = _read_tsv(file("metadata"))
        col = {h: i for i, h in enumerate(header)}
        self.study_ids = np.array([int(r[col["id"]]) for r in rows])
        self.spaces = np.array([r[col["space"]] for r in rows])
        self.vocabulary = [line.strip() for line in file("vocabulary").read_text(encoding="utf-8").splitlines()]
        features = sparse.load_npz(str(file("features"))).tocsc()
        if features.shape != (len(self.study_ids), len(self.vocabulary)):
            raise ValueError(f"Neurosynth features {features.shape} do not match metadata and vocabulary")
        self.uses = (features >= TERM_THRESHOLD).astype(np.float32).tocsc()  # (studies, terms)
        self.term_counts = np.asarray(self.uses.sum(axis=0)).ravel().astype(int)
        self._index = {t: i for i, t in enumerate(self.vocabulary)}

        if cache and cache.exists():
            with np.load(cache, allow_pickle=False) as f:
                self.activation = sparse.csr_matrix(
                    (f["data"], f["indices"], f["indptr"]), shape=tuple(f["shape"])
                )
                self.n_peaks = int(f["n_peaks"])
        else:
            self.activation, self.n_peaks = self._activation(file("coordinates"))
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                a = self.activation
                np.savez_compressed(
                    cache, data=a.data, indices=a.indices, indptr=a.indptr, shape=a.shape, n_peaks=self.n_peaks
                )
        self.activation_t = self.activation.T.tocsr()  # (voxels, studies)
        self.active_counts = np.asarray(self.activation.sum(axis=0)).ravel().astype(np.float64)
        self.n_studies = self.activation.shape[0]

    def _activation(self, coordinates: Path) -> tuple[sparse.csr_matrix, int]:
        header, rows = _read_tsv(coordinates)
        col = {h: i for i, h in enumerate(header)}
        study_row = {sid: i for i, sid in enumerate(self.study_ids)}
        ids = np.array([int(r[col["id"]]) for r in rows])
        xyz = np.array([[float(r[col[a]]) for a in "xyz"] for r in rows])
        keep = np.array([i in study_row for i in ids])
        ids, xyz = ids[keep], xyz[keep]
        study = np.array([study_row[i] for i in ids])
        tal = self.spaces[study] == "TAL"
        xyz[tal] = tal_to_mni(xyz[tal])
        tree = cKDTree(self.grid.centres)
        pairs = []
        for start in range(0, len(xyz), 20000):
            hits = tree.query_ball_point(xyz[start : start + 20000], r=KERNEL_MM)
            lengths = np.fromiter(map(len, hits), dtype=np.int64, count=len(hits))
            voxels = np.fromiter(itertools.chain.from_iterable(hits), dtype=np.int64, count=int(lengths.sum()))
            studies = np.repeat(study[start : start + 20000], lengths)
            pairs.append(np.unique(studies * self.grid.size + voxels))
        flat = np.unique(np.concatenate(pairs))
        rows_, cols_ = np.divmod(flat, self.grid.size)
        matrix = sparse.csr_matrix(
            (np.ones(len(flat), dtype=np.float32), (rows_, cols_)), shape=(len(self.study_ids), self.grid.size)
        )
        return matrix, int(len(xyz))

    def index(self, term: str) -> int | None:
        return self._index.get(term.strip().lower())

    def studies(self, terms: list[int]) -> np.ndarray:
        """Studies whose abstract uses any of the terms."""
        return np.asarray(self.uses[:, terms].sum(axis=1)).ravel() > 0

    def association(self, selected: np.ndarray) -> np.ndarray:
        """Association-test z-map for a set of studies (bool per study)."""
        return self._association(selected[:, None].astype(np.float32))[0]

    def term_maps(self, terms: np.ndarray) -> np.ndarray:
        """(k, voxels) association-test z-maps of single terms."""
        return self._association(self.uses[:, np.asarray(terms)].toarray())

    def _association(self, selected: np.ndarray) -> np.ndarray:
        n = float(self.n_studies)
        n_term = selected.sum(axis=0).astype(np.float64)  # (k,)
        a = np.asarray(self.activation_t @ selected, dtype=np.float64)  # term studies active: (voxels, k)
        active = self.active_counts[:, None]
        b = active - a  # other studies active
        c = n_term[None, :] - a  # term studies inactive
        d = n - n_term[None, :] - b  # other studies inactive
        with np.errstate(divide="ignore", invalid="ignore"):
            chi2 = n * (a * d - b * c) ** 2 / (active * (n - active) * n_term[None, :] * (n - n_term[None, :]))
        chi2 = np.nan_to_num(chi2, nan=0.0, posinf=0.0)
        z = np.sign(a * d - b * c) * np.minimum(np.sqrt(chi2), Z_CAP)
        return z.T.astype(np.float32)


def fdr_threshold(z: np.ndarray, q: float = FDR_Q) -> float | None:
    """Smallest |z| that survives Benjamini–Hochberg FDR at q (two-sided); None if none does."""
    p = special.erfc(np.abs(z.astype(np.float64)) / np.sqrt(2))
    order = np.sort(p)
    m = len(order)
    passed = np.flatnonzero(order <= q * np.arange(1, m + 1) / m)
    if not len(passed):
        return None
    return float(np.sqrt(2) * special.erfcinv(order[passed[-1]]))

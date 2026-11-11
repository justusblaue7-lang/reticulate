"""Projection of meta-analytic maps onto the atlas geometry, and their display statistics.

Maps are z-scores on NeuroQuery's 4-mm MNI152 grid (see literature.py); the atlas lives in
fsaverage space (MNI305), so atlas coordinates are converted with FreeSurfer's linear
MNI305 -> MNI152 transform before sampling. Cortex is sampled at three depths between the
white and pial surfaces and averaged; deep structures are sampled just inside their meshes
for display and over their segmentation voxels for structure means.
"""

import numpy as np
from scipy import sparse

from reticulate.atlas.geometry import DeepMesh, Hemisphere, vertex_normals
from reticulate.atlas.literature import Grid, Projector

# FreeSurfer, "CoordinateSystems": MNI152 = M · MNI305.
MNI305_TO_MNI152 = np.array(
    [
        [0.9975, -0.0073, 0.0176, -0.0429],
        [0.0146, 1.0009, -0.0024, 1.5496],
        [-0.0130, -0.0093, 0.9971, 1.1840],
        [0.0, 0.0, 0.0, 1.0],
    ]
)
CORTEX_DEPTHS = (0.2, 0.5, 0.8)  # fractions of cortical thickness between white and pial
DEEP_INSET_MM = 1.5
QUANT_SCALE = 5.0  # stored as int8: z * 5, i.e. 0.2 z resolution, range about ±25
DISPLAY_THRESHOLD = 3.1


def to_mni152(points: np.ndarray) -> np.ndarray:
    return (MNI305_TO_MNI152 @ np.c_[points, np.ones(len(points))].T).T[:, :3]


def build_projector(
    grid: Grid, cortex: dict[str, Hemisphere], deep: list[DeepMesh], cortex_keys: dict[str, np.ndarray], keys: list[str]
) -> Projector:
    """Operator for [lh vertices | rh vertices | deep vertices] and for each structure in `keys`."""
    blocks, structure_rows = [], {}
    for name, h in cortex.items():
        n = len(h.pial)
        layers = np.vstack([h.white + f * (h.pial - h.white) for f in CORTEX_DEPTHS])
        sampled = grid.trilinear(to_mni152(layers))
        per_vertex = sampled[:n]
        for k in range(1, len(CORTEX_DEPTHS)):
            per_vertex = per_vertex + sampled[k * n : (k + 1) * n]
        per_vertex = per_vertex / len(CORTEX_DEPTHS)
        blocks.append(per_vertex)
        for key in np.unique(cortex_keys[name]):
            members = np.flatnonzero(cortex_keys[name] == key)
            structure_rows[str(key)] = sparse.csr_matrix(per_vertex[members].mean(axis=0))
    if deep:
        inset = np.vstack([m.vertices - DEEP_INSET_MM * vertex_normals(m.vertices, m.faces) for m in deep])
        blocks.append(grid.trilinear(to_mni152(inset)))
        for m in deep:
            structure_rows[m.key] = sparse.csr_matrix(grid.trilinear(to_mni152(m.voxels)).mean(axis=0))
    vertices = sparse.vstack(blocks).tocsr().astype(np.float32)
    structures = sparse.vstack([structure_rows[k] for k in keys]).tocsr().astype(np.float32)
    return Projector(vertices, structures, keys)


def quantised(values: np.ndarray) -> bytes:
    return np.clip(np.round(values * QUANT_SCALE), -128, 127).astype(np.int8).tobytes()


def display_max(values: np.ndarray) -> float:
    positive = values[values > DISPLAY_THRESHOLD]
    return float(min(25.0, np.percentile(positive, 99))) if len(positive) else DISPLAY_THRESHOLD + 1


def coverage(values: np.ndarray, n_cortex: int) -> float:
    """Share of cortical vertices above the display threshold."""
    return float((values[:n_cortex] > DISPLAY_THRESHOLD).mean())


def top_structures(means: np.ndarray, keys: list[str], n: int = 10, skip: set[str] = frozenset()) -> list[dict]:
    order = [i for i in np.argsort(-means) if keys[i] not in skip][:n]
    return [{"key": keys[i], "z": round(float(means[i]), 2)} for i in order]


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    """Spatial Pearson correlation over the grid (descriptive; maps are smooth)."""
    if a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def dice(a: np.ndarray, b: np.ndarray, threshold: float = DISPLAY_THRESHOLD) -> float | None:
    """Overlap of the suprathreshold voxels of two maps; None when neither has any."""
    x, y = a >= threshold, b >= threshold
    total = x.sum() + y.sum()
    return round(float(2 * (x & y).sum() / total), 3) if total else None

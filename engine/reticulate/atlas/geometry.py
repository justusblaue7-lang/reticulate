"""Brain geometry from FreeSurfer's fsaverage subject.

Cortex: full-resolution fsaverage surfaces (163,842 vertices per hemisphere) with the
Desikan–Killiany parcellation and the Yeo 7-network annotation. Deep structures,
cerebellum, brainstem and corpus callosum: surfaces extracted from fsaverage's aseg
segmentation, in the same coordinate frame (fsaverage scanner RAS = MNI305).
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage, sparse

from reticulate.science import Region

FSAVERAGE_DIR = Path(
    os.getenv("RETICULATE_FSAVERAGE", Path.home() / "mne_data" / "MNE-fsaverage-data" / "fsaverage")
)
HEMIS = ("lh", "rh")
INFLATED_GAP_MM = 8.0


@dataclass
class Hemisphere:
    name: str
    pial: np.ndarray  # (V, 3) float
    white: np.ndarray
    inflated: np.ndarray  # offset so both hemispheres sit side by side, centred like the pial surface
    faces: np.ndarray  # (F, 3) int
    sulc: np.ndarray  # (V,) normalised to [-1, 1], positive = deep
    aparc: np.ndarray  # (V,) Desikan–Killiany label name per vertex
    network: np.ndarray  # (V,) Yeo-7 index, 0 = medial wall
    network_colors: dict[int, tuple[int, int, int]] = field(default_factory=dict)


@dataclass
class DeepMesh:
    region: str  # region id from regions.yaml
    hemi: str | None  # "lh", "rh" or None for midline structures
    vertices: np.ndarray  # (N, 3) RAS mm
    faces: np.ndarray  # (M, 3) int, outward-facing
    voxels: np.ndarray  # (K, 3) RAS mm of the segmentation voxels, for region averages

    @property
    def key(self) -> str:
        return f"{self.hemi}.{self.region}" if self.hemi else self.region


def _read_annot(path: Path) -> tuple[np.ndarray, list[str], np.ndarray]:
    labels, ctab, names = nib.freesurfer.read_annot(str(path))
    return labels, [n.decode() if isinstance(n, bytes) else str(n) for n in names], ctab


def load_hemisphere(hemi: str, fs_dir: Path = FSAVERAGE_DIR) -> Hemisphere:
    surf = fs_dir / "surf"
    pial, faces = nib.freesurfer.read_geometry(str(surf / f"{hemi}.pial"))
    white, _ = nib.freesurfer.read_geometry(str(surf / f"{hemi}.white"))
    inflated, _ = nib.freesurfer.read_geometry(str(surf / f"{hemi}.inflated"))
    sulc = nib.freesurfer.read_morph_data(str(surf / f"{hemi}.sulc")).astype(np.float64)
    labels, names, _ = _read_annot(fs_dir / "label" / f"{hemi}.aparc.annot")
    aparc = np.array([names[i] if i >= 0 else "unknown" for i in labels])
    yeo, _, yeo_ctab = _read_annot(fs_dir / "label" / f"{hemi}.Yeo2011_7Networks_N1000.annot")
    colors = {i: tuple(int(c) for c in yeo_ctab[i, :3]) for i in range(1, 8)}
    return Hemisphere(
        name=hemi,
        pial=pial.astype(np.float64),
        white=white.astype(np.float64),
        inflated=inflated.astype(np.float64),
        faces=faces.astype(np.int64),
        sulc=sulc / np.abs(sulc).max(),
        aparc=aparc,
        network=np.clip(yeo, 0, 7).astype(np.int64),
        network_colors=colors,
    )


def load_cortex(fs_dir: Path = FSAVERAGE_DIR) -> dict[str, Hemisphere]:
    hemis = {h: load_hemisphere(h, fs_dir) for h in HEMIS}
    # Place the inflated hemispheres side by side, centred where the pial brain is.
    pial_all = np.vstack([hemis["lh"].pial, hemis["rh"].pial])
    centre = (pial_all.min(0) + pial_all.max(0)) / 2
    for h in hemis.values():
        inf = h.inflated - (h.inflated.min(0) + h.inflated.max(0)) / 2
        half_width = (inf[:, 0].max() - inf[:, 0].min()) / 2
        shift_x = -(half_width + INFLATED_GAP_MM / 2) if h.name == "lh" else half_width + INFLATED_GAP_MM / 2
        h.inflated = inf + np.array([shift_x, centre[1], centre[2]])
    return hemis


def vertex_adjacency(faces: np.ndarray, n: int) -> sparse.csr_matrix:
    i = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0]])
    j = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 0], faces[:, 1], faces[:, 2]])
    adj = sparse.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    adj.data[:] = 1.0
    return adj


def boundary_vertices(faces: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """True where a vertex shares an edge with a vertex of another label."""
    a, b, c = labels[faces[:, 0]], labels[faces[:, 1]], labels[faces[:, 2]]
    mixed = (a != b) | (b != c) | (a != c)
    flag = np.zeros(len(labels), dtype=bool)
    flag[faces[mixed].ravel()] = True
    return flag


def vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    tri = vertices[faces]
    face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    normals = np.zeros_like(vertices)
    for k in range(3):
        np.add.at(normals, faces[:, k], face_normals)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


def vertex_areas(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    tri = vertices[faces]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    per_vertex = np.zeros(len(vertices))
    for k in range(3):
        np.add.at(per_vertex, faces[:, k], area / 3)
    return per_vertex


def taubin_smooth(vertices: np.ndarray, faces: np.ndarray, iterations: int, lam=0.5, mu=-0.53) -> np.ndarray:
    adj = vertex_adjacency(faces, len(vertices))
    degree = np.asarray(adj.sum(axis=1)).ravel()
    degree[degree == 0] = 1
    out = vertices.copy()
    for _ in range(iterations):
        for factor in (lam, mu):
            out = out + factor * (adj @ out / degree[:, None] - out)
    return out


def _marching_cubes(mask: np.ndarray, affine: np.ndarray, smooth_sigma: float) -> tuple[np.ndarray, np.ndarray]:
    from skimage.measure import marching_cubes

    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(0) - 3, 0)
    hi = np.minimum(idx.max(0) + 4, mask.shape)
    crop = mask[lo[0] : hi[0], lo[1] : hi[1], lo[2] : hi[2]].astype(np.float32)
    field_ = ndimage.gaussian_filter(crop, smooth_sigma)
    verts, faces, _, _ = marching_cubes(field_, level=0.5)
    verts = verts + lo
    ras = (affine @ np.c_[verts, np.ones(len(verts))].T).T[:, :3]
    faces = faces.astype(np.int64)
    # Orient faces outward: the signed volume of a closed outward-facing mesh is positive.
    tri = ras[faces]
    signed_volume = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
    if signed_volume < 0:
        faces = faces[:, [0, 2, 1]]
    return ras, faces


def load_deep_meshes(regions: list[Region], fs_dir: Path = FSAVERAGE_DIR) -> list[DeepMesh]:
    aseg_img = nib.load(str(fs_dir / "mri" / "aseg.mgz"))
    aseg = np.asarray(aseg_img.dataobj)
    affine = aseg_img.header.get_vox2ras_tkr()
    meshes = []
    for region in regions:
        if region.kind != "deep":
            continue
        labels = [int(x) for x in region.atlas_labels]
        if region.id == "cerebellum":  # merge cerebellar cortex with its white matter (7 / 46)
            groups = [("lh", [8, 7]), ("rh", [47, 46])]
        elif len(labels) == 2:
            groups = [("lh", [labels[0]]), ("rh", [labels[1]])]
        else:
            groups = [(None, labels)]
        for hemi, group in groups:
            mask = np.isin(aseg, group)
            if not mask.any():
                raise ValueError(f"aseg has no voxels for {region.id} {group}")
            vertices, faces = _marching_cubes(mask, affine, smooth_sigma=1.0)
            vertices = taubin_smooth(vertices, faces, iterations=6)
            voxels = (affine @ np.c_[np.argwhere(mask), np.ones(mask.sum())].T).T[:, :3]
            meshes.append(DeepMesh(region.id, hemi, vertices, faces, voxels))
    return meshes


def envelope(hemi: Hemisphere) -> tuple[np.ndarray, np.ndarray]:
    """A smooth, low-resolution outer shell of the hemisphere, drawn as a glass outline.

    fsaverage5 vertices are the first 10,242 vertices of fsaverage, so a heavily smoothed
    full-resolution surface can be subsampled onto fsaverage5's triangulation.
    """
    from nilearn import datasets, surface

    side = "left" if hemi.name == "lh" else "right"
    fs5 = datasets.fetch_surf_fsaverage("fsaverage5")
    mesh5 = surface.load_surf_mesh(fs5[f"pial_{side}"])
    n5 = len(mesh5.coordinates)
    # Correspondence is defined on the sphere (nilearn's fsaverage5 pial was resampled separately).
    sphere5 = surface.load_surf_mesh(fs5[f"sphere_{side}"]).coordinates
    sphere, _ = nib.freesurfer.read_geometry(str(FSAVERAGE_DIR / "surf" / f"{hemi.name}.sphere"))
    unit = lambda a: a / np.linalg.norm(a, axis=1, keepdims=True)  # noqa: E731
    if np.degrees(np.arccos(np.clip((unit(sphere5) * unit(sphere[:n5])).sum(1), -1, 1))).max() > 0.1:
        raise ValueError("fsaverage5 is not a vertex subset of fsaverage; cannot build envelope")
    smooth = taubin_smooth(hemi.pial, hemi.faces, iterations=60)
    return smooth[:n5], np.asarray(mesh5.faces, dtype=np.int64)

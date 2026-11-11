"""The two literature sources (skipped unless their data are installed)."""

import numpy as np
import pytest

from reticulate.atlas import literature
from reticulate.atlas.build import CACHE_DIR

pytestmark = pytest.mark.skipif(
    not (literature.NEUROQUERY_DIR / "vocabulary.csv").exists() or not (CACHE_DIR / "neurosynth_mkda_4mm.npz").exists(),
    reason="NeuroQuery model or Neurosynth cache not installed",
)


@pytest.fixture(scope="module")
def grid():
    return literature.Grid.load()


def test_batched_feature_maps_equal_the_model(grid):
    nq = literature.NeuroQuerySource(grid)
    for term in ("reward", "theory mind"):
        batched = nq.feature_maps(np.array([nq.index(term)]))[0]
        direct, _ = nq.query(term)
        assert np.corrcoef(batched, direct)[0, 1] > 0.9999 and np.abs(batched - direct).max() < 1e-3


def test_neurosynth_association_maps_peak_where_expected(grid):
    ns = literature.NeurosynthSource(grid, cache=CACHE_DIR / "neurosynth_mkda_4mm.npz")
    assert ns.n_studies == 14371 and len(ns.vocabulary) == 3228
    peaks = {}
    for term in ("fear", "reward"):
        z = ns.term_maps(np.array([ns.index(term)]))[0]
        peaks[term] = grid.centres[np.argmax(z)]
    assert abs(peaks["fear"][0]) > 15 and -12 < peaks["fear"][1] < 6 and peaks["fear"][2] < -10  # amygdala
    assert abs(peaks["reward"][0]) < 16 and peaks["reward"][1] > 2 and peaks["reward"][2] < 2  # ventral striatum


def test_fdr_threshold_is_none_for_noise_and_finite_for_signal():
    rng = np.random.default_rng(1)
    assert literature.fdr_threshold(rng.normal(size=20000)) is None
    signal = np.r_[rng.normal(size=19000), rng.normal(6, 1, size=1000)]
    assert 3 < literature.fdr_threshold(signal) < 5


def test_talairach_conversion_is_close_to_identity_near_the_origin():
    assert np.abs(literature.tal_to_mni(np.zeros((1, 3)))).max() < 5

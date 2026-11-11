"""Consistency of the generated atlas assets (skipped until they are built)."""

import json
from pathlib import Path

import numpy as np
import pytest

from reticulate.atlas.build import ATLAS_DIR
from reticulate.science import science

pytestmark = pytest.mark.skipif(not (ATLAS_DIR / "vocabulary.json").exists(), reason="atlas not built")


def _json(name: str) -> dict:
    return json.loads((ATLAS_DIR / name).read_text())


def test_geometry_buffers_fit_the_binary():
    geometry = _json("geometry.json")
    size = (ATLAS_DIR / "geometry.bin").stat().st_size
    item = {"float32": 4, "uint32": 4, "uint8": 1, "int8": 1}
    for name, entry in geometry["buffers"].items():
        assert entry["offset"] + entry["length"] * item[entry["dtype"]] <= size, name


def test_every_structure_is_in_the_atlas_and_every_atlas_key_is_curated():
    keys = {r["key"] for r in _json("geometry.json")["regions"]}
    curated = {r.id for r in science().regions}
    assert {k.split(".")[-1] for k in keys} == curated
    assert len(keys) == 90


def test_every_curated_map_covers_every_vertex_in_each_of_its_sources():
    maps = _json("maps.json")
    total = sum(maps["layout"].values())
    for entry in maps["maps"]:
        assert entry["sources"], entry["id"]
        for source in entry["sources"].values():
            assert Path(ATLAS_DIR / source["file"]).stat().st_size == total, entry["id"]
    sci = science()
    expected = {f"stimulus.{s.id}" for s in sci.stimuli} | {f"construct.{d}" for d in sci.dimension_ids}
    expected |= {f"feature.{f.id}" for f in sci.features if f.neuroquery or f.neurosynth}
    assert {m["id"] for m in maps["maps"]} == expected


def test_perception_controls_agree_across_sources():
    maps = {m["id"]: m for m in _json("maps.json")["maps"]}
    for control in ("visual_scene", "tones", "speech", "touch", "finger_tapping"):
        assert maps[f"stimulus.{control}"]["agreement"]["r"] > 0.6, control


def _decode(key: str, source: str = "neuroquery") -> list[str]:
    vocabulary = _json("vocabulary.json")
    raw = np.frombuffer((ATLAS_DIR / "decoding.bin").read_bytes(), dtype=np.int16)
    table = vocabulary[source]
    n = len(vocabulary["structures"])
    means = raw[table["offset"] : table["offset"] + len(table["terms"]) * n].reshape(-1, n)
    column = means[:, vocabulary["structures"].index(key)]
    categories = [c for c, _ in vocabulary["categories"]]
    evidence = table["documents"] if source == "neuroquery" else table["studies"]
    usable = [i for i, (c, e) in enumerate(zip(table["category"], evidence)) if categories[c] in ("concept", "task") and e >= 50]
    return [table["terms"][i] for i in sorted(usable, key=lambda i: -column[i])][:8]


def test_structures_decode_to_their_function_in_both_sources():
    for source in ("neuroquery", "neurosynth"):
        assert any("audit" in t for t in _decode("lh.transversetemporal", source)), source
        assert "fear" in _decode("lh.amygdala", source), source
        assert any("memory" in t or "retrieval" in t for t in _decode("lh.hippocampus", source)), source
        assert {"reward", "gambling", "reinforcement"} & set(_decode("rh.accumbens", source)), source

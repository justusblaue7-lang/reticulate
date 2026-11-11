import pytest
from pydantic import ValidationError

from reticulate.science import Science, science


def test_science_data_loads_and_cross_references_resolve():
    s = science()
    assert len(s.dimensions) == 8
    assert {r.id for r in s.regions if r.kind == "cortex"} >= {"insula", "precuneus", "frontalpole"}
    assert {r.id for r in s.regions if r.kind == "deep"} >= {"amygdala", "cerebellum", "brainstem"}


def test_every_dimension_has_a_construct_map_and_a_finding():
    s = science()
    assert all(d.construct_map.query for d in s.dimensions)
    assert {link.dimension for link in s.links} == set(s.dimension_ids)


def test_unknown_reference_is_rejected():
    data = science().model_dump()
    data["links"][0]["refs"] = ["nobody1999"]
    with pytest.raises(ValidationError, match="nobody1999"):
        Science.model_validate(data)


def test_link_to_unknown_region_is_rejected():
    data = science().model_dump()
    data["links"][0]["region"] = "nowhere"
    with pytest.raises(ValidationError, match="nowhere"):
        Science.model_validate(data)


def test_decision_features_point_to_known_dimensions_and_mechanisms():
    s = science()
    mechanisms = {m.id for m in s.mechanisms}
    assert all(set(f.mechanisms) <= mechanisms and set(f.dimensions) <= set(s.dimension_ids) for f in s.features)
    used = {m for f in s.features for m in f.mechanisms}
    assert used == mechanisms, f"mechanisms no feature engages: {mechanisms - used}"


def test_unknown_mechanism_is_rejected():
    data = science().model_dump()
    data["features"][0]["mechanisms"] = ["mind_reading"]
    with pytest.raises(ValidationError, match="mind_reading"):
        Science.model_validate(data)


def test_every_mechanism_has_a_countermove_and_every_feature_a_self_check_question():
    sci = science()
    assert all(m.countermove.text for m in sci.mechanisms)
    tested = [m for m in sci.mechanisms if m.countermove.basis == "tested"]
    assert len(tested) >= 5 and all(m.countermove.finding and m.countermove.refs for m in tested)
    assert all(f.ask.endswith("?") and "decision-maker" not in f.ask for f in sci.features)

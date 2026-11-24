import pytest
from pydantic import ValidationError

from reticulate.science import Science, science


def test_science_data_loads_and_cross_references_resolve():
    s = science()
    assert s.dimension_ids == ["risk_taking", "patience", "altruism", "trust", "positive_reciprocity", "negative_reciprocity"]
    assert {r.id for r in s.regions if r.kind == "cortex"} >= {"insula", "precuneus", "frontalpole"}
    assert {r.id for r in s.regions if r.kind == "deep"} >= {"amygdala", "cerebellum", "brainstem"}
    assert s.links == []  # no brain findings per attitude since 1.0


def test_every_attitude_is_a_validated_survey_question():
    s = science()
    for d in s.dimensions:
        assert "falk2023" in d.refs and any(i.ref == "falk2023" for i in d.instruments), d.id
        assert d.reasoning.low and d.reasoning.high


def test_unknown_reference_is_rejected():
    data = science().model_dump()
    data["mechanisms"][0]["refs"] = ["nobody1999"]
    with pytest.raises(ValidationError, match="nobody1999"):
        Science.model_validate(data)


def test_every_bias_rests_on_large_evidence():
    # docs/epistemics.md: a meta-analysis, a multi-site replication or field data, never brain data alone
    for m in science().mechanisms:
        assert m.evidence and all(e.design in {"meta_analysis", "replication", "field"} for e in m.evidence), m.id


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


def test_remedies_and_findings_only_where_proven_and_every_feature_a_self_check_question():
    sci = science()
    remedies = [m for m in sci.mechanisms if m.countermove]
    assert {m.id for m in remedies} == {"probability_weighting", "present_bias"}
    assert all(m.countermove.finding and m.countermove.refs for m in remedies)
    assert all(not m.finding or m.refs for m in sci.socratic.moves)
    assert {m.id for m in sci.socratic.moves if m.finding} == {"options", "outcomes", "values", "commitment"}
    assert all(f.ask.endswith("?") and "decision-maker" not in f.ask for f in sci.features)

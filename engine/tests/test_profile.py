import pytest
from pydantic import ValidationError

from reticulate.profile import CognitiveProfile, ProfileKind
from reticulate.provenance import Provenance
from reticulate.science import science


def _dims(value=5):
    return {d: value for d in science().dimension_ids}


def test_personas_are_complete_and_not_caricatures(library):
    personas = library.list()
    assert len(personas) >= 10
    for p in personas:
        assert p.kind == ProfileKind.PERSONA
        assert p.nuance, f"{p.id} needs a nuance"
        assert all(score.provenance == Provenance.AUTHORED for score in p.dimensions.values())
        extremes = sum(1 for v in p.vector() if v in (0, 10))
        assert extremes <= 1, f"{p.id} is pinned to the scale ends on {extremes} dimensions"


def test_missing_dimension_is_rejected():
    dims = _dims()
    dims.pop("risk_taking")
    with pytest.raises(ValidationError, match="risk_taking"):
        CognitiveProfile(id="x", name="X", dimensions=dims)


def test_out_of_range_score_is_rejected():
    with pytest.raises(ValidationError):
        CognitiveProfile(id="x", name="X", dimensions=_dims(11))


def test_figure_inspired_profiles_require_sources():
    with pytest.raises(ValidationError, match="public sources"):
        CognitiveProfile(id="x", name="X", kind="figure_inspired", dimensions=_dims())


def test_counterfactual_variant(library):
    base = library.get("insurance_claims_clerk")
    variant = base.with_value("risk_taking", 8)
    assert variant.id == "insurance_claims_clerk~risk_taking=8"
    assert variant.value("risk_taking") == 8 and base.value("risk_taking") == 1
    assert variant.dimensions["risk_taking"].source == "counterfactual"


def test_a_profile_saved_before_1_0_opens_with_its_attitudes_carried_over():
    from reticulate.profile import CognitiveProfile

    old = {
        "id": "my_cfo", "name": "CFO", "kind": "custom", "summary": "x",
        "dimensions": {"risk_tolerance": 3, "exploration": 7, "time_horizon": 8, "analytical_style": 9,
                       "experimentation": 4, "social_orientation": 2, "uncertainty_tolerance": 5, "cognitive_flexibility": 6},
    }
    p = CognitiveProfile.model_validate(old)
    assert p.value("risk_taking") == 3 and p.value("patience") == 8 and p.value("altruism") == 2
    assert p.value("trust") == 5 and "before 1.0" in p.dimensions["trust"].source

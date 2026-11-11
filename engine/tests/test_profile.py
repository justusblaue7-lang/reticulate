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
    dims.pop("risk_tolerance")
    with pytest.raises(ValidationError, match="risk_tolerance"):
        CognitiveProfile(id="x", name="X", dimensions=dims)


def test_out_of_range_score_is_rejected():
    with pytest.raises(ValidationError):
        CognitiveProfile(id="x", name="X", dimensions=_dims(11))


def test_figure_inspired_profiles_require_sources():
    with pytest.raises(ValidationError, match="public sources"):
        CognitiveProfile(id="x", name="X", kind="figure_inspired", dimensions=_dims())


def test_counterfactual_variant(library):
    base = library.get("cooperative_bank_credit_officer")
    variant = base.with_value("risk_tolerance", 8)
    assert variant.id == "cooperative_bank_credit_officer~risk_tolerance=8"
    assert variant.value("risk_tolerance") == 8 and base.value("risk_tolerance") == 2
    assert variant.dimensions["risk_tolerance"].source == "counterfactual"

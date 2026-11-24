"""The person's own pattern: the six survey answers, their leanings, and how the dialogue holds it."""

import pytest

from reticulate.api import app, get_engine, get_optional_engine
from reticulate.decision import Decision
from reticulate.dialogue import prompts
from reticulate.dialogue.schemas import Conclusion, SocraticTurn
from reticulate.pattern import PatternRequest, build, leanings, score
from reticulate.science import science
from tests.fakes import FakeEngine
from tests.test_api import QUESTION, client  # noqa: F401  (fixture)


def answers(**by_dimension: int) -> dict[str, int]:
    """The answer (0–10) per attitude; 5 where not given."""
    return {item.id: by_dimension.get(item.dimension, 5) for item in science().pattern.items}


# Cautious, impatient and giving, with no other leaning.
CAUTIOUS = answers(risk_taking=0, patience=3, altruism=9)


@pytest.fixture
def held(client):  # noqa: F811
    fake = FakeEngine()
    app.dependency_overrides[get_engine] = lambda: fake
    app.dependency_overrides[get_optional_engine] = lambda: fake
    return client, fake


def test_every_attitude_has_one_survey_question_and_what_both_ends_go_with():
    sci = science()
    for dim in sci.dimension_ids:
        assert sum(i.dimension == dim for i in sci.pattern.items) == 1
        for pole in ("low", "high"):
            assert sci.pattern.leaning(dim, pole).watch
    assert all(i.low and i.high for i in sci.pattern.items)


def test_the_answer_is_the_value():
    assert set(score(answers()).values()) == {5.0}
    scores = score(answers(risk_taking=10, trust=0, patience=7))
    assert scores["risk_taking"] == 10 and scores["trust"] == 0 and scores["patience"] == 7


@pytest.mark.parametrize(
    "bad, message",
    [({"gps_risk": 3}, "missing"), ({**answers(), "telepathy": 3}, "unknown"), ({**answers(), "gps_risk": 11}, "0 to 10")],
)
def test_the_pattern_needs_every_question_once_on_the_scale(bad, message):
    with pytest.raises(ValueError, match=message):
        score(bad)


def test_leanings_are_the_pronounced_answers_strongest_first():
    found = leanings(score(CAUTIOUS))
    assert [(x.dimension, x.pole, x.strength) for x in found] == [
        ("risk_taking", "low", "clear"),  # 0
        ("altruism", "high", "clear"),  # 9
        ("patience", "low", "some"),  # 3
    ]
    adjusted = build(PatternRequest(answers=CAUTIOUS, adjust={"risk_taking": 6}))
    assert adjusted.dimensions["risk_taking"].adjusted and adjusted.provenance == "authored"
    assert "risk_taking" not in {x.dimension for x in leanings({k: v.value for k, v in adjusted.dimensions.items()})}


def test_the_person_block_gives_the_answers_what_they_go_with_and_validated_biases():
    assert prompts.person_block(None) is None
    block = prompts.person_block(score(CAUTIOUS))
    sci = science()
    assert block.startswith("<person>") and block.endswith("</person>")
    assert 'risk_taking (Risk taking): 0, toward "Cautious"' in block
    assert sci.pattern.leaning("risk_taking", "low").watch in block
    assert "present_bias (Present bias)" in block  # patience was validated against intertemporal choice
    assert "No particular leaning: Trust, Positive reciprocity, Negative reciprocity" in block
    assert "Global Preferences Survey" in block
    guide = prompts.system_prompt()
    assert "<person>" in guide and "Never show scores" in guide and "Counterweight" not in guide


def test_a_new_dialogue_holds_the_pattern_it_started_with(held):
    client, fake = held
    assert client.get("/api/pattern").json() is None
    saved = client.put("/api/pattern", json={"answers": CAUTIOUS}).json()
    assert saved["provenance"] == "authored" and saved["dimensions"]["risk_taking"]["value"] == 0
    assert client.get("/api/pattern").json()["dimensions"] == saved["dimensions"]

    created = client.post("/api/decisions", json={"problem": QUESTION}).json()
    assert created["dialogue"]["pattern"]["risk_taking"] == 0 and created["dialogue"]["pattern_at"]
    decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={}).json()

    # Changing the pattern later leaves a started dialogue as it was
    client.put("/api/pattern", json={"answers": answers()})
    for answer in ("The lease runs ten years.", "Security matters most.", "Maybe a smaller stake."):
        decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={"answer": answer}).json()
    assert all(p is not None and p["risk_taking"] == 0 for p in fake.patterns)
    turns = [e["turn"] for e in decision["dialogue"]["exchanges"]]
    # Turn 2 named a dimension without a leaning (dropped); turn 3 counterweighs a real one
    assert [t["pattern"] for t in turns] == ["none", "none", "risk_taking", "none"]

    concluded = client.post(f"/api/decisions/{created['id']}/dialogue/conclude", json={"answer": "Go small."}).json()
    notes = concluded["dialogue"]["conclusion"]["pattern_notes"]
    assert notes == [{"dimension": "risk_taking", "note": "My caution made staying feel safe."}]


def test_without_a_pattern_the_dialogue_ignores_leanings(held):
    client, fake = held
    created = client.post("/api/decisions", json={"problem": QUESTION}).json()
    assert created["dialogue"]["pattern"] is None
    decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={}).json()
    for answer in ("One", "Two", "Three"):
        decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={"answer": answer}).json()
    assert {e["turn"]["pattern"] for e in decision["dialogue"]["exchanges"]} == {"none"}
    concluded = client.post(f"/api/decisions/{created['id']}/dialogue/conclude", json={"answer": "Done."}).json()
    assert concluded["dialogue"]["conclusion"]["pattern_notes"] == []
    assert fake.patterns and all(p is None for p in fake.patterns)


def test_a_bad_self_rating_is_refused_and_the_pattern_can_be_deleted(held):
    client, _ = held
    assert client.put("/api/pattern", json={"answers": {"gps_risk": 3}}).status_code == 422
    client.put("/api/pattern", json={"answers": CAUTIOUS})
    assert client.delete("/api/pattern").json() == {"deleted": True}
    assert client.get("/api/pattern").json() is None


def test_records_from_earlier_builds_still_load():
    turn = SocraticTurn.model_json_schema()
    assert "pattern" in turn["required"]  # structured output keeps it required
    old_turn = {
        "reflection": "",
        "question": "What is fixed?",
        "move": "clarify",
        "stage": "frame",
        "mechanism_id": "none",
        "why": "test",
        "scale": False,
        "notes": {
            "decision": "x", "goals": [], "options": [], "facts": [], "unknowns": [],
            "assumptions": [], "leaning": "", "confidence": -1,
        },
        "ready": False,
    }
    assert SocraticTurn.model_validate(old_turn).pattern == "none"
    # moves of the science before 1.0 map to the move that replaced them
    assert SocraticTurn.model_validate({**old_turn, "move": "premortem"}).move == "check"
    assert SocraticTurn.model_validate({**old_turn, "move": "alternative"}).move == "options"
    old_conclusion = {
        "decided": True, "choice": "A", "statement": "I go.", "reasons": [], "tradeoffs": [], "revisit_if": [],
        "open_questions": [], "first_step": "x", "if_then": "If x, then y.", "review": "soon", "quality": [],
    }
    assert Conclusion.model_validate(old_conclusion).pattern_notes == []
    assert Decision.model_fields["dialogue"]  # the dialogue's pattern defaults to None

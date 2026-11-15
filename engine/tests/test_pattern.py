"""The person's own pattern: the self-rating, its leanings, and how the dialogue holds it."""

import pytest

from reticulate.api import app, get_engine, get_optional_engine
from reticulate.decision import Decision
from reticulate.dialogue import prompts
from reticulate.dialogue.schemas import Conclusion, SocraticTurn
from reticulate.pattern import PatternRequest, build, leanings, score
from reticulate.science import science
from tests.fakes import FakeEngine
from tests.test_api import QUESTION, client  # noqa: F401  (fixture)


def answers(**by_dimension: tuple[int, int]) -> dict[str, int]:
    """(high item, low item) per dimension; 3 and 3 where not given."""
    out = {}
    for item in science().pattern.items:
        high, low = by_dimension.get(item.dimension, (3, 3))
        out[item.id] = high if item.pole == "high" else low
    return out


# A cautious, intuitive, socially oriented person with no other leaning.
CAUTIOUS = answers(risk_tolerance=(1, 5), analytical_style=(2, 4), social_orientation=(5, 2))


@pytest.fixture
def held(client):  # noqa: F811
    fake = FakeEngine()
    app.dependency_overrides[get_engine] = lambda: fake
    app.dependency_overrides[get_optional_engine] = lambda: fake
    return client, fake


def test_every_dimension_has_a_statement_toward_each_pole_and_leanings_for_both():
    sci = science()
    for dim in sci.dimension_ids:
        assert sorted(i.pole for i in sci.pattern.items if i.dimension == dim) == ["high", "low"]
        for pole in ("low", "high"):
            lean = sci.pattern.leaning(dim, pole)
            assert lean.watch and lean.counterweight


def test_reversed_statements_cancel_agreeing_with_everything():
    assert set(score(answers()).values()) == {5.0}
    all_yes = {i.id: 5 for i in science().pattern.items}
    assert set(score(all_yes).values()) == {5.0}  # acquiescence cancels out
    scores = score(answers(risk_tolerance=(5, 1), exploration=(1, 5), time_horizon=(4, 2)))
    assert scores["risk_tolerance"] == 10 and scores["exploration"] == 0 and scores["time_horizon"] == 7.5


@pytest.mark.parametrize(
    "bad, message",
    [({"risk_high": 3}, "missing"), ({**answers(), "telepathy": 3}, "unknown"), ({**answers(), "risk_high": 6}, "1 to 5")],
)
def test_the_self_rating_needs_every_statement_once_on_the_scale(bad, message):
    with pytest.raises(ValueError, match=message):
        score(bad)


def test_leanings_are_the_pronounced_dimensions_strongest_first():
    found = leanings(score(CAUTIOUS))
    assert [(x.dimension, x.pole, x.strength) for x in found] == [
        ("risk_tolerance", "low", "clear"),  # 0
        ("social_orientation", "high", "clear"),  # 8.75
        ("analytical_style", "low", "clear"),  # 2.5
    ]
    adjusted = build(PatternRequest(answers=CAUTIOUS, adjust={"risk_tolerance": 6}))
    assert adjusted.dimensions["risk_tolerance"].adjusted and adjusted.provenance == "authored"
    assert "risk_tolerance" not in {x.dimension for x in leanings({k: v.value for k, v in adjusted.dimensions.items()})}


def test_the_person_block_names_each_leaning_with_its_counterweight_and_mechanisms():
    assert prompts.person_block(None) is None
    block = prompts.person_block(score(CAUTIOUS))
    sci = science()
    assert block.startswith("<person>") and block.endswith("</person>")
    assert "risk_tolerance (Risk tolerance): 0, toward \"Cautious\"" in block
    assert sci.pattern.leaning("risk_tolerance", "low").counterweight.split()[0] in block
    assert "loss_aversion (Loss aversion)" in block and "social_conformity (Social conformity)" in block
    assert sci.pattern.leaning("analytical_style", "low").style in block
    assert "No particular leaning: Exploration, Time horizon" in block
    assert "not a measurement" in block
    # The guide knows how to use it, and that it is not to be shown
    guide = prompts.system_prompt()
    assert "<person>" in guide and "Counterweight, do not correct" in guide and "Never show scores" in guide


def test_a_new_dialogue_holds_the_pattern_it_started_with(held):
    client, fake = held
    assert client.get("/api/pattern").json() is None
    saved = client.put("/api/pattern", json={"answers": CAUTIOUS}).json()
    assert saved["provenance"] == "authored" and saved["dimensions"]["risk_tolerance"]["value"] == 0
    assert client.get("/api/pattern").json()["dimensions"] == saved["dimensions"]

    created = client.post("/api/decisions", json={"problem": QUESTION}).json()
    assert created["dialogue"]["pattern"]["risk_tolerance"] == 0 and created["dialogue"]["pattern_at"]
    decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={}).json()

    # Changing the pattern later leaves a started dialogue as it was
    client.put("/api/pattern", json={"answers": answers()})
    for answer in ("The lease runs ten years.", "Security matters most.", "Maybe a smaller stake."):
        decision = client.post(f"/api/decisions/{created['id']}/dialogue", json={"answer": answer}).json()
    assert all(p is not None and p["risk_tolerance"] == 0 for p in fake.patterns)
    turns = [e["turn"] for e in decision["dialogue"]["exchanges"]]
    # Turn 2 named a dimension without a leaning (dropped); turn 3 counterweighs a real one
    assert [t["pattern"] for t in turns] == ["none", "none", "risk_tolerance", "none"]

    concluded = client.post(f"/api/decisions/{created['id']}/dialogue/conclude", json={"answer": "Go small."}).json()
    notes = concluded["dialogue"]["conclusion"]["pattern_notes"]
    assert notes == [{"dimension": "risk_tolerance", "note": "My caution made staying feel safe."}]


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
    assert client.put("/api/pattern", json={"answers": {"risk_high": 3}}).status_code == 422
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
    old_conclusion = {
        "decided": True, "choice": "A", "statement": "I go.", "reasons": [], "tradeoffs": [], "revisit_if": [],
        "open_questions": [], "first_step": "x", "if_then": "If x, then y.", "review": "soon", "quality": [],
    }
    assert Conclusion.model_validate(old_conclusion).pattern_notes == []
    assert Decision.model_fields["dialogue"]  # the dialogue's pattern defaults to None

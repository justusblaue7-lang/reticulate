"""The Socratic dialogue: prompts, workflow and its endpoints."""

import json

import pytest

from reticulate.dialogue import prompts
from reticulate.dialogue.workflow import PROMPT_VERSION
from reticulate.simulation.prompts import render_profile
from tests.fakes import GO
from tests.test_api import QUESTION, analysed, client, configured  # noqa: F401  (fixtures)


def _start(client) -> dict:
    created = client.post("/api/decisions", json={"problem": QUESTION}).json()
    return client.post(f"/api/decisions/{created['id']}/dialogue", json={}).json()


def _say(client, decision_id: str, answer: str | None = None, skip: bool = False):
    return client.post(f"/api/decisions/{decision_id}/dialogue", json={"answer": answer, "skip": skip})


def test_system_prompt_is_frozen_and_compiled_from_the_science():
    text = prompts.system_prompt()
    assert text == prompts.system_prompt() and len(PROMPT_VERSION) == 12
    for needle in ('"id": "premortem"', '"id": "commitment"', '"id": "loss_aversion"', "Think like a trader"):
        assert needle in text
    assert "<stages>" in text and "<moves>" in text and "<mechanisms>" in text


def test_messages_alternate_and_end_with_the_person(configured):
    decision = _start(configured)
    decision = _say(configured, decision["id"], "It is about the lease.").json()
    decision = _say(configured, decision["id"], skip=True).json()
    from reticulate.decision import Decision

    record = Decision.model_validate(decision)
    messages = prompts.messages(record.problem, record.dialogue.exchanges[:-1])
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant", "user"]
    assert messages[0]["content"].endswith(prompts.START) and QUESTION["question"] in messages[0]["content"]
    assert json.loads(messages[1]["content"])["question"] == "Question 1 about frame?"
    assert messages[2]["content"] == "It is about the lease." and messages[4]["content"] == prompts.SKIPPED
    with pytest.raises(ValueError, match="no answer"):
        prompts.messages(record.problem, record.dialogue.exchanges)  # the last question is still open
    closing = prompts.messages(record.problem, record.dialogue.exchanges, conclude=True)
    assert closing[-1] == {"role": "user", "content": f"{prompts.UNANSWERED}\n\n{prompts.CONCLUDE}"}


def test_a_dialogue_reaches_a_decision_that_is_saved_and_readable(configured, data_dir):
    decision = _start(configured)
    first = decision["dialogue"]["exchanges"][0]["turn"]
    assert first["question"] == "Question 1 about frame?" and first["reflection"] == ""
    for answer in ("Whether to open in March.", "Stability for my family.", "Wait a year instead."):
        decision = _say(configured, decision["id"], answer).json()
    turns = [e["turn"] for e in decision["dialogue"]["exchanges"]]
    assert len(turns) == 4 and turns[1]["reflection"] == "You said: Whether to open in March."
    assert turns[1]["mechanism_id"] == "none"  # the fake guide named an unknown mechanism
    assert turns[2]["mechanism_id"] == "status_quo_bias"
    assert [e["answer"] for e in decision["dialogue"]["exchanges"]][:3] == ["Whether to open in March.", "Stability for my family.", "Wait a year instead."]

    concluded = configured.post(f"/api/decisions/{decision['id']}/dialogue/conclude", json={"answer": "Yes, I'm sure."}).json()
    conclusion = concluded["dialogue"]["conclusion"]
    assert conclusion["choice"] == GO and conclusion["statement"].endswith("Yes, I'm sure..")
    assert [q["stage"] for q in conclusion["quality"]] == ["frame", "options"]  # in the order of the stages
    settled = configured.put(f"/api/decisions/{decision['id']}/settled", json={"items": ["Ask the bank", "Ask the bank", " "]}).json()
    assert settled["settled"] == ["Ask the bank"]

    listed = configured.get("/api/decisions").json()[0]
    assert listed["status"] == "decided" and listed["decided"] == GO and listed["questions"] == 4 and "dialogue" in listed["steps"]
    folder = data_dir / listed["file"].rsplit("/", 1)[0]
    assert folder.name.startswith(concluded["created_at"][:10]) and folder.name.endswith(concluded["id"][:8])
    readable = (folder / "decision.md").read_text()
    assert "## Your decision" in readable and "Stability for my family." in readable
    assert "- [x] Ask the bank" in readable and "- [ ] Check the lease" in readable
    assert "**3. Question 3 about options?**" in readable and "against status quo bias" in readable


def test_answers_need_an_open_question_and_a_concluded_dialogue_can_be_reopened(configured):
    decision = _start(configured)
    decision_id = decision["id"]
    assert _say(configured, decision_id, "").status_code == 409  # an open question needs an answer or a skip
    configured.post(f"/api/decisions/{decision_id}/dialogue/conclude", json={})
    assert _say(configured, decision_id, "More").status_code == 409
    reopened = configured.post(f"/api/decisions/{decision_id}/dialogue/reopen").json()
    assert reopened["dialogue"]["conclusion"] is None
    assert len(_say(configured, decision_id, "More").json()["dialogue"]["exchanges"]) == 2


def test_revising_an_answer_drops_what_came_after(configured):
    decision = _start(configured)
    for answer in ("A", "B", "C"):
        decision = _say(configured, decision["id"], answer).json()
    revised = configured.post(f"/api/decisions/{decision['id']}/dialogue/revise", json={"index": 1}).json()
    exchanges = revised["dialogue"]["exchanges"]
    assert len(exchanges) == 2 and exchanges[0]["answer"] == "A" and exchanges[1]["answer"] is None
    assert configured.post(f"/api/decisions/{decision['id']}/dialogue/revise", json={"index": 9}).status_code == 409
    again = _say(configured, decision["id"], "B, revised").json()
    assert [e["answer"] for e in again["dialogue"]["exchanges"]] == ["A", "B, revised", None]


def test_the_panel_result_reaches_the_guide_with_the_next_answer(configured):
    from reticulate.api import get_engine

    engine = configured.app.dependency_overrides[get_engine]()  # the one FakeEngine of this client
    decision = _start(configured)
    analysed(configured, decision["id"])
    configured.post(f"/api/decisions/{decision['id']}/panel", json={"profiles": ["venture_capitalist", "municipal_treasurer"], "replicates": 1})
    queued = configured.get(f"/api/decisions/{decision['id']}").json()
    assert queued["dialogue"]["pending"] and queued["dialogue"]["pending"][0].startswith("<panel>")
    answered = _say(configured, decision["id"], "Interesting.").json()
    first = answered["dialogue"]["exchanges"][0]
    assert first["context"].startswith("<panel>") and "simulated decision-makers" in first["context"]
    assert answered["dialogue"]["pending"] == []
    assert any(item and item.startswith("<panel>") for item in engine.seen[-1])


def test_a_decision_rated_by_hand_can_start_a_dialogue_later(configured):
    anatomy = [{"feature_id": "possible_loss", "level": 3}]
    created = configured.post("/api/decisions", json={"problem": QUESTION, "anatomy": anatomy}).json()
    assert created["dialogue"] is None and created["analysis"] == "none"
    started = configured.post(f"/api/decisions/{created['id']}/dialogue", json={}).json()
    assert len(started["dialogue"]["exchanges"]) == 1


def test_people_are_shown_by_name_and_look_but_simulated_by_role(library):
    profile = library.get("family_business_successor")
    assert profile.person and profile.person.name and profile.person.look
    text = render_profile(profile)
    assert profile.name in text
    for leak in (profile.person.name, profile.person.look, *profile.person.name.split()):
        assert leak not in text

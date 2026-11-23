"""The public engine: stateless, the visitor's own key, the decision travels with each request."""

import pytest
from fastapi.testclient import TestClient

from reticulate import public, trial
from tests.fakes import FakeEngine

PROBLEM = {"question": "Should I take the job in Berlin?", "context": "", "options": ["Take it", "Stay"]}
KEY = {"x-anthropic-key": "sk-ant-test-key-0000000000"}


@pytest.fixture(autouse=True)
def fake_claude(monkeypatch):
    """Every engine is the fake one, whatever key it was made with; no house key unless a test sets one."""
    monkeypatch.setattr(public, "make_engine", lambda key: FakeEngine())
    monkeypatch.delenv(trial.HOUSE_KEY, raising=False)
    trial._seen.clear()


def client() -> TestClient:
    return TestClient(public.app)


def test_needs_a_key():
    c = TestClient(public.app)
    assert c.get("/api/status").json()["trial"] is None
    r = c.post("/api/decision/new", json={"problem": PROBLEM})
    assert r.status_code == 401
    # rated by hand, no key is needed
    r = c.post("/api/decision/new", json={"problem": PROBLEM, "anatomy": []})
    assert r.status_code == 200


def test_dialogue_round_trip_stores_nothing(tmp_path, monkeypatch):
    c = client()
    created = c.post("/api/decision/new", json={"problem": PROBLEM}, headers=KEY).json()
    d = created["decision"]
    assert created["summary"]["question"] == PROBLEM["question"]
    analysed = c.post("/api/decision/analyse", json={"decision": d}, headers=KEY).json()
    d = c.post("/api/decision/apply-analysis", json={"decision": d, **analysed}).json()["decision"]
    assert d["analysis"] == "done", analysed
    r = c.post("/api/decision/reply", json={"decision": d, "answer": None}, headers=KEY).json()
    d = r["decision"]
    assert len(d["dialogue"]["exchanges"]) == 1 and d["dialogue"]["exchanges"][0]["answer"] is None
    r = c.post("/api/decision/reply", json={"decision": d, "answer": "Mostly the people."}, headers=KEY).json()
    assert len(r["decision"]["dialogue"]["exchanges"]) == 2
    assert r["summary"]["status"] == "in dialogue"
    d = c.post("/api/decision/conclude", json={"decision": r["decision"], "answer": "I'll take it."}, headers=KEY).json()["decision"]
    assert d["dialogue"]["conclusion"] is not None
    d = c.post("/api/decision/settle", json={"decision": d, "items": ["a", "a", " "]}).json()["decision"]
    assert d["settled"] == ["a"]
    assert d["trial_grant"] is None  # on the visitor's own key


HOUSE = "sk-ant-house-key-0000000000"


def test_free_decisions_on_the_house_key(monkeypatch):
    monkeypatch.setenv(trial.HOUSE_KEY, HOUSE)
    monkeypatch.setenv("RETICULATE_TRIAL_DECISIONS", "2")
    c = client()
    assert c.get("/api/status").json()["trial"] == {"decisions": 2, "days": 14}

    first = c.post("/api/decision/new", json={"problem": PROBLEM}).json()
    assert first["trial"]["used"] == 1 and first["trial"]["left"] == 1
    d = first["decision"]
    assert d["trial_grant"]
    # the rest of a free decision runs on the house key
    analysed = c.post("/api/decision/analyse", json={"decision": d}).json()
    assert analysed["analysis"] is not None
    r = c.post("/api/decision/reply", json={"decision": d, "answer": None})
    assert r.status_code == 200 and r.json()["decision"]["trial_grant"] == d["trial_grant"]

    token = first["trial"]["token"]
    second = c.post("/api/decision/new", json={"problem": PROBLEM}, headers={"x-reticulate-trial": token}).json()
    assert second["trial"]["left"] == 0
    r = c.post("/api/decision/new", json={"problem": PROBLEM}, headers={"x-reticulate-trial": second["trial"]["token"]})
    assert r.status_code == 402 and "used up" in r.json()["detail"]
    # an edited pass is not honoured as such
    edited = second["trial"]["token"].replace(".2.", ".0.")
    assert c.post("/api/decision/new", json={"problem": PROBLEM}, headers={"x-reticulate-trial": edited}).json()["trial"]["used"] == 1
    # the visitor's own key spends nothing
    own = c.post("/api/decision/new", json={"problem": PROBLEM}, headers=KEY).json()
    assert own["trial"] is None and own["decision"]["trial_grant"] is None


def test_a_grant_holds_for_its_own_decision_only(monkeypatch):
    monkeypatch.setenv(trial.HOUSE_KEY, HOUSE)
    c = client()
    d = c.post("/api/decision/new", json={"problem": PROBLEM}).json()["decision"]
    other = c.post("/api/decision/new", json={"problem": PROBLEM}, headers=KEY).json()["decision"]
    stolen = {**other, "trial_grant": d["trial_grant"]}
    assert c.post("/api/decision/reply", json={"decision": stolen, "answer": None}).status_code == 401
    expired = trial.grant(d["id"], now=0)
    r = c.post("/api/decision/reply", json={"decision": {**d, "trial_grant": expired}, "answer": None})
    assert r.status_code == 402
    # without a house key, a grant is worth nothing
    monkeypatch.delenv(trial.HOUSE_KEY)
    assert c.post("/api/decision/reply", json={"decision": d, "answer": None}).status_code == 401


def test_the_network_brake(monkeypatch):
    monkeypatch.setenv(trial.HOUSE_KEY, HOUSE)
    monkeypatch.setattr(trial, "CALLS_PER_HOUR", 2)
    c = client()
    d = c.post("/api/decision/new", json={"problem": PROBLEM}).json()["decision"]
    assert c.post("/api/decision/reply", json={"decision": d, "answer": None}).status_code == 200
    assert c.post("/api/decision/reply", json={"decision": d, "answer": None}).status_code == 429


def test_pattern_and_avatars():
    c = TestClient(public.app)
    assert c.get("/api/status").json()["public"] is True
    personas = c.get("/api/avatars").json()
    assert personas
    copy = c.post("/api/avatar", json={"profile": personas[0]}).json()
    assert copy["id"] != personas[0]["id"] and copy["origin"] == "user"
    science = c.get("/api/science").json()
    answers = {i["id"]: 3 for i in science["pattern"]["items"]}
    p = c.post("/api/pattern", json={"answers": answers}).json()
    assert all(v["value"] == 5 for v in p["dimensions"].values())

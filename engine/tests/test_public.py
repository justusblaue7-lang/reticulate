"""The public engine: stateless, the visitor's own key, the decision travels with each request."""

from fastapi.testclient import TestClient

from reticulate import public
from tests.fakes import FakeEngine

PROBLEM = {"question": "Should I take the job in Berlin?", "context": "", "options": ["Take it", "Stay"]}
KEY = {"x-anthropic-key": "sk-ant-test-key-0000000000"}


def client() -> TestClient:
    public.app.dependency_overrides[public.get_engine] = lambda: FakeEngine()
    return TestClient(public.app)


def test_needs_a_key():
    c = TestClient(public.app)
    public.app.dependency_overrides.clear()
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
    analysed = c.post("/api/decision/analyse", json={"decision": d}).json()
    d = c.post("/api/decision/apply-analysis", json={"decision": d, **analysed}).json()["decision"]
    assert d["analysis"] == "done", analysed
    r = c.post("/api/decision/reply", json={"decision": d, "answer": None}).json()
    d = r["decision"]
    assert len(d["dialogue"]["exchanges"]) == 1 and d["dialogue"]["exchanges"][0]["answer"] is None
    r = c.post("/api/decision/reply", json={"decision": d, "answer": "Mostly the people."}).json()
    assert len(r["decision"]["dialogue"]["exchanges"]) == 2
    assert r["summary"]["status"] == "in dialogue"
    d = c.post("/api/decision/conclude", json={"decision": r["decision"], "answer": "I'll take it."}).json()["decision"]
    assert d["dialogue"]["conclusion"] is not None
    d = c.post("/api/decision/settle", json={"decision": d, "items": ["a", "a", " "]}).json()["decision"]
    assert d["settled"] == ["a"]
    public.app.dependency_overrides.clear()


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

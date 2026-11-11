import pytest
from fastapi.testclient import TestClient

from reticulate.api import app, get_engine, get_library, get_optional_engine
from reticulate.library import Library
from tests.fakes import FakeEngine

QUESTION = {"question": "Should I open a second location next year?", "options": ["Open it", "Wait a year"]}


@pytest.fixture
def client(tmp_path):
    library = Library.load(user_dir=tmp_path / "avatars")
    app.dependency_overrides[get_library] = lambda: library
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def unconfigured(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    return client


@pytest.fixture
def configured(client):
    fake = FakeEngine()
    app.dependency_overrides[get_engine] = lambda: fake
    app.dependency_overrides[get_optional_engine] = lambda: fake
    return client


def test_status_and_science(client):
    status = client.get("/api/status").json()
    assert {"claude", "literature", "version"} <= set(status)
    body = client.get("/api/science").json()
    assert len(body["dimensions"]) == 8 and len(body["stimuli"]) > 20
    assert len(body["features"]) > 10 and len(body["mechanisms"]) > 10 and len(body["personality"]["traits"]) == 5


def test_analysis_without_key_explains_setup(unconfigured):
    response = unconfigured.post("/api/decisions", json={"problem": QUESTION})
    assert response.status_code == 503 and "Connect Claude" in response.json()["detail"]


def test_hand_set_anatomy_works_without_claude(unconfigured):
    anatomy = [{"feature_id": "possible_loss", "level": 3}, {"feature_id": "delayed_outcomes", "level": 2}]
    response = unconfigured.post("/api/decisions", json={"problem": QUESTION, "anatomy": anatomy})
    assert response.status_code == 200
    body = response.json()
    assert body["frame"] is None and body["anatomy"][0]["source"] == "user"
    assert [m["mechanism_id"] for m in body["signature"]["mechanisms"]][:1] == ["loss_aversion"]
    panel = unconfigured.post(f"/api/decisions/{body['id']}/panel", json={"profiles": ["venture_capitalist"]})
    assert panel.status_code == 503


def test_decision_flow_is_saved(configured):
    created = configured.post("/api/decisions", json={"problem": QUESTION}).json()
    assert created["frame"]["options"] and created["signature"]["dimensions"][0]["dimension_id"] == "risk_tolerance"
    panel = configured.post(
        f"/api/decisions/{created['id']}/panel",
        json={"profiles": ["venture_capitalist", "municipal_treasurer"], "replicates": 2},
    ).json()
    assert panel["panel"]["meta"]["replicates"] == 2 and panel["panel"]["meta"]["neural_context"]
    tipping = configured.post(
        f"/api/decisions/{created['id']}/tipping",
        json={"profile": "municipal_treasurer", "keys": ["risk_tolerance", "neuroticism"], "values": [2, 8]},
    ).json()
    assert [t["dimension"] for t in tipping["tipping"]] == ["risk_tolerance", "neuroticism"]
    again = configured.post(
        f"/api/decisions/{created['id']}/tipping",
        json={"profile": "municipal_treasurer", "keys": ["risk_tolerance"], "values": [5, 9]},
    ).json()
    assert [(t["dimension"], t["values"]) for t in again["tipping"]] == [("neuroticism", [2, 8]), ("risk_tolerance", [5, 9])]
    assert configured.get(f"/api/decisions/{created['id']}/progress").json() is None
    listed = configured.get("/api/decisions").json()
    assert listed[0]["id"] == created["id"] and listed[0]["steps"] == ["analysis", "panel", "tipping"]
    assert listed[0]["title"] == QUESTION["question"] and listed[0]["verdict"] in ("1/2 · Go ahead", "1/2 · Keep the status quo")


def test_analysis_keeps_watch_outs_for_known_mechanisms(configured):
    created = configured.post("/api/decisions", json={"problem": QUESTION}).json()
    assert [w["mechanism_id"] for w in created["watch_outs"]] == ["loss_aversion", "present_bias"]
    assert "watch_outs" not in created["frame"]


def test_tipping_rejects_unknown_keys(configured):
    created = configured.post("/api/decisions", json={"problem": QUESTION}).json()
    response = configured.post(
        f"/api/decisions/{created['id']}/tipping", json={"profile": "venture_capitalist", "keys": ["charisma"]}
    )
    assert response.status_code == 422


def test_reanalysis_drops_a_panel_that_saw_the_old_context(configured):
    created = configured.post("/api/decisions", json={"problem": QUESTION}).json()
    configured.post(f"/api/decisions/{created['id']}/panel", json={"profiles": ["venture_capitalist"], "replicates": 1})
    updated = configured.put(
        f"/api/decisions/{created['id']}/anatomy", json={"anatomy": [{"feature_id": "threat", "level": 3, "source": "user"}]}
    ).json()
    assert updated["panel"] is None and updated["signature"]["mechanisms"][0]["mechanism_id"] == "threat_and_anxiety"


def test_user_avatars_can_be_saved_and_deleted_but_personas_cannot(client):
    persona = next(a for a in client.get("/api/avatars").json() if a["id"] == "venture_capitalist")
    copy = client.post("/api/avatars", json={**persona, "name": "My investor"}).json()
    assert copy["id"] == "my_investor" and copy["origin"] == "user" and copy["phenotype"]["hair"] == "coily"
    assert any(a["id"] == "my_investor" for a in client.get("/api/avatars").json())
    assert client.delete("/api/avatars/venture_capitalist").status_code == 422
    assert client.delete("/api/avatars/my_investor").status_code == 200


class _Models:
    def __init__(self, error):
        self.error = error

    async def retrieve(self, model):
        if self.error:
            raise self.error
        return {"id": model}


def _client_raising(error):
    return lambda api_key: type("Client", (), {"models": _Models(error)})()


def test_claude_key_is_checked_stored_and_removed(unconfigured, monkeypatch, tmp_path):
    import anthropic
    import httpx

    from reticulate import api as api_module
    from reticulate import config

    env = tmp_path / ".env"
    env.write_text("RETICULATE_EFFORT=high\n")
    monkeypatch.setattr(config, "ENV_FILE", env)
    key = "sk-ant-api03-" + "x" * 40 + "WXYZ"

    assert unconfigured.put("/api/settings/claude", json={"api_key": "sk-proj-" + "x" * 30}).status_code == 422
    rejected = anthropic.AuthenticationError(
        "invalid x-api-key", response=httpx.Response(401, request=httpx.Request("GET", "https://api.anthropic.com")), body=None
    )
    monkeypatch.setattr(api_module.anthropic, "AsyncAnthropic", _client_raising(rejected))
    assert unconfigured.put("/api/settings/claude", json={"api_key": key}).status_code == 401
    assert "sk-ant" not in env.read_text()

    monkeypatch.setattr(api_module.anthropic, "AsyncAnthropic", _client_raising(None))
    status = unconfigured.put("/api/settings/claude", json={"api_key": key}).json()
    assert status["claude"]["configured"] and status["claude"]["key_hint"] == "…WXYZ"
    assert env.read_text() == f"RETICULATE_EFFORT=high\nANTHROPIC_API_KEY={key}\n"
    assert "sk-ant" not in unconfigured.get("/api/status").text.replace("…WXYZ", "")

    status = unconfigured.delete("/api/settings/claude").json()
    assert not status["claude"]["configured"] and env.read_text() == "RETICULATE_EFFORT=high\n"

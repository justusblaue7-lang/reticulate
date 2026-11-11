"""Run log: every decision, simulation and dose–response run is stored as one JSON file.

The files are the research record: problem, anatomy, signature, profiles, frame, every
replicate's output, the analysis, and the model, effort, prompt version and token usage
that produced them. A decision is rewritten in place as its steps complete.
"""

import json
from collections import Counter
from pathlib import Path

from pydantic import BaseModel

from reticulate.config import settings
from reticulate.decision.schemas import Decision
from reticulate.simulation.schemas import SensitivityResult, SimulationResult

Record = Decision | SimulationResult | SensitivityResult


class RunSummary(BaseModel):
    id: str
    kind: str
    created_at: str
    updated_at: str
    question: str
    title: str  # the decision as Claude restated it, or the question
    verdict: str | None  # the panel's most chosen option with its share, e.g. "3/4 · Invest"
    label: str  # panel of a decision or simulation, or profile and dimension of a dose–response run
    steps: list[str]  # decision steps completed: analysis, panel, tipping
    cost_usd: float | None
    file: str


def _dir() -> Path:
    path = settings().runs_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(record: Record) -> Path:
    stamp = record.created_at.strftime("%Y%m%d-%H%M%S")
    return _dir() / f"{stamp}-{record.kind}-{record.id[:8]}.json"


def save(record: Record) -> Path:
    path = _path(record)
    path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
    return path


def _summary(path: Path, data: dict) -> RunSummary:
    kind = data["kind"]
    steps: list[str] = []
    cost, verdict = None, None
    title = ((data.get("frame") or {}).get("decision")) or data["problem"]["question"]
    if kind == "decision":
        panel = data.get("panel")
        label = ", ".join(p["name"] for p in panel["profiles"]) if panel else "no panel yet"
        steps = ["analysis"] + (["panel"] if panel else []) + (["tipping"] if data.get("tipping") else [])
        cost = (data.get("usage") or {}).get("cost_usd")
        if panel:
            choices = [tally["option"] for tally in panel["space"]["recommendations"].values()]
            top = Counter(choices).most_common(1)[0]
            verdict = f"{top[1]}/{len(choices)} · {top[0]}"
    elif kind == "simulation":
        label = ", ".join(p["name"] for p in data["profiles"])
    else:
        label = f"{data['profile']['name']} · {data['dimension']} {', '.join(f'{v:g}' for v in data['values'])}"
    return RunSummary(
        id=data["id"],
        kind=kind,
        created_at=data["created_at"],
        updated_at=data.get("updated_at", data["created_at"]),
        question=data["problem"]["question"],
        title=title,
        verdict=verdict,
        label=label,
        steps=steps,
        cost_usd=cost,
        file=path.name,
    )


def list_runs(kind: str | None = None) -> list[RunSummary]:
    summaries = []
    for path in sorted(_dir().glob("*.json"), reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if kind is None or data.get("kind") == kind:
                summaries.append(_summary(path, data))
        except (KeyError, ValueError, TypeError):
            continue  # not a run file
    return summaries


def _find(run_id: str) -> Path:
    for path in _dir().glob(f"*-{run_id[:8]}.json"):
        if json.loads(path.read_text(encoding="utf-8")).get("id") == run_id:
            return path
    raise KeyError(run_id)


def load(run_id: str) -> dict:
    return json.loads(_find(run_id).read_text(encoding="utf-8"))


def load_decision(run_id: str) -> Decision:
    return Decision.model_validate(load(run_id))


def delete(run_id: str) -> None:
    _find(run_id).unlink()

"""Storage: everything you make in Reticulate, as files in the project's data folder.

    data/decisions/<date>-<question>-<id>/decision.json   the full record of a decision
                                         /decision.md     the same decision to read and share
    data/runs/<time>-<kind>-<id>.json                     research runs from the command line
    data/avatars/<id>.yaml                                your own avatars (see library/)

A decision is rewritten in place as its steps complete: every answer in the dialogue, the
analysis, the panel. The JSON is the research record (problem, dialogue, analysis, panel,
model, prompt versions, tokens and cost); the Markdown copy is regenerated from it each time.
"""

import json
import os
import re
import shutil
import unicodedata
from collections import Counter
from pathlib import Path

from pydantic import BaseModel

from reticulate.config import ENGINE_DIR, settings
from reticulate.decision.schemas import Decision
from reticulate.simulation.schemas import SensitivityResult, SimulationResult

Record = Decision | SimulationResult | SensitivityResult

RECORD = "decision.json"
READABLE = "decision.md"


class RunSummary(BaseModel):
    id: str
    kind: str
    created_at: str
    updated_at: str
    question: str
    title: str  # the decision as framed in the dialogue or the analysis, or the question
    status: str  # decided | in dialogue | analysed | rated | (runs) simulation, sensitivity
    decided: str | None  # the choice, once the dialogue is concluded
    questions: int  # questions asked in the dialogue
    verdict: str | None  # the panel's most chosen option with its share, e.g. "3/4 · Invest"
    label: str  # panel of a decision or simulation, or profile and dimension of a dose–response run
    steps: list[str]  # completed: dialogue, decided, analysis, panel, tipping
    cost_usd: float | None
    file: str  # path relative to the data folder


# --- paths --------------------------------------------------------------------------------


def _slug(text: str, limit: int = 48) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    words = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-").split("-")
    slug = ""
    for word in words:
        if len(slug) + len(word) + 1 > limit:
            break
        slug = f"{slug}-{word}" if slug else word
    return slug or "decision"


def _decisions() -> Path:
    path = settings().decisions_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _runs() -> Path:
    path = settings().runs_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _decision_folder(decision_id: str) -> Path | None:
    for folder in _decisions().glob(f"*-{decision_id[:8]}"):
        record = folder / RECORD
        if record.exists() and json.loads(record.read_text(encoding="utf-8")).get("id") == decision_id:
            return folder
    return None


def folder(decision_id: str) -> Path:
    """The folder that holds a decision."""
    found = _decision_folder(decision_id)
    if found is None:
        raise KeyError(decision_id)
    return found


def _write(path: Path, text: str) -> None:
    """Write atomically, so that a reader never sees half a file."""
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# --- saving and loading -------------------------------------------------------------------


def save(record: Record) -> Path:
    if isinstance(record, Decision):
        from reticulate.report import markdown

        target = _decision_folder(record.id)
        if target is None:
            name = f"{record.created_at:%Y-%m-%d}-{_slug(record.problem.question)}-{record.id[:8]}"
            target = _decisions() / name
            target.mkdir(parents=True)
        _write(target / RECORD, record.model_dump_json(indent=2))
        _write(target / READABLE, markdown(record))
        return target / RECORD
    path = _runs() / f"{record.created_at:%Y%m%d-%H%M%S}-{record.kind}-{record.id[:8]}.json"
    _write(path, record.model_dump_json(indent=2))
    return path


def _summary(path: Path, data: dict) -> RunSummary:
    kind = data["kind"]
    steps: list[str] = []
    cost, verdict, decided, questions = None, None, None, 0
    dialogue = data.get("dialogue") or {}
    notes = (dialogue.get("exchanges") or [{}])[-1].get("turn", {}).get("notes", {}) if dialogue.get("exchanges") else {}
    title = notes.get("decision") or ((data.get("frame") or {}).get("decision")) or data["problem"]["question"]
    status = kind
    if kind == "decision":
        panel = data.get("panel")
        label = ", ".join(p["name"] for p in panel["profiles"]) if panel else ""
        questions = len(dialogue.get("exchanges") or [])
        conclusion = dialogue.get("conclusion")
        if questions:
            steps.append("dialogue")
        if conclusion:
            steps.append("decided")
            decided = conclusion.get("choice")
        if data.get("frame") or any(r.get("level") for r in data.get("anatomy") or []):
            steps.append("analysis")
        if panel:
            steps.append("panel")
            choices = [tally["option"] for tally in panel["space"]["recommendations"].values()]
            top = Counter(choices).most_common(1)[0]
            verdict = f"{top[1]}/{len(choices)} · {top[0]}"
        if data.get("tipping"):
            steps.append("tipping")
        cost = (data.get("usage") or {}).get("cost_usd")
        status = (
            "decided" if conclusion else "in dialogue" if questions else "analysed" if data.get("frame") else "rated"
        )
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
        status=status,
        decided=decided,
        questions=questions,
        verdict=verdict,
        label=label,
        steps=steps,
        cost_usd=cost,
        file=str(path.relative_to(settings().data_dir)),
    )


def _records(kind: str | None) -> list[Path]:
    paths: list[Path] = []
    if kind in (None, "decision"):
        paths += list(_decisions().glob(f"*/{RECORD}"))
    if kind != "decision":
        paths += list(_runs().glob("*.json"))
    return paths


def list_runs(kind: str | None = None) -> list[RunSummary]:
    summaries = []
    for path in _records(kind):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if kind is None or data.get("kind") == kind:
                summaries.append(_summary(path, data))
        except (KeyError, ValueError, TypeError, IndexError):
            continue  # not a record
    return sorted(summaries, key=lambda s: s.updated_at, reverse=True)


def _find(run_id: str) -> Path:
    decision = _decision_folder(run_id)
    if decision is not None:
        return decision / RECORD
    for path in _runs().glob(f"*-{run_id[:8]}.json"):
        if json.loads(path.read_text(encoding="utf-8")).get("id") == run_id:
            return path
    raise KeyError(run_id)


def load(run_id: str) -> dict:
    return json.loads(_find(run_id).read_text(encoding="utf-8"))


def load_decision(run_id: str) -> Decision:
    return Decision.model_validate(load(run_id))


def delete(run_id: str) -> None:
    path = _find(run_id)
    if path.name == RECORD:
        shutil.rmtree(path.parent)
    else:
        path.unlink()


# --- moving data from earlier builds ------------------------------------------------------

LEGACY_RUNS = ENGINE_DIR / "runs"
LEGACY_AVATARS = ENGINE_DIR / "avatars"


def migrate_legacy(runs_dir: Path = LEGACY_RUNS, avatars_dir: Path = LEGACY_AVATARS) -> list[str]:
    """Move records and avatars of builds before 0.5 (engine/runs, engine/avatars) into the
    data folder. Each file is written to its new place and read back before the old copy
    is removed, so nothing is lost if a step fails."""
    moved: list[str] = []
    if runs_dir.is_dir():
        for path in sorted(runs_dir.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("kind") == "decision":
                record = Decision.model_validate(data)
                target = save(record)
                if load_decision(record.id).id != record.id:
                    raise RuntimeError(f"could not verify the moved decision {path.name}")
            else:
                target = _runs() / path.name
                shutil.copy2(path, target)
                if json.loads(target.read_text(encoding="utf-8")).get("id") != data.get("id"):
                    raise RuntimeError(f"could not verify the moved run {path.name}")
            path.unlink()
            moved.append(f"{path.name} -> {target.relative_to(settings().data_dir)}")
    if avatars_dir.is_dir():
        target_dir = settings().avatars_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        for path in sorted(avatars_dir.glob("*.yaml")):
            target = target_dir / path.name
            if not target.exists():
                shutil.copy2(path, target)
            if target.read_bytes() != path.read_bytes():
                continue  # a different avatar of the same name exists; leave both in place
            path.unlink()
            moved.append(f"{path.name} -> {target.relative_to(settings().data_dir)}")
    for legacy in (runs_dir, avatars_dir):
        if legacy.is_dir() and not any(p for p in legacy.iterdir() if p.name != ".DS_Store"):
            shutil.rmtree(legacy)
    return moved

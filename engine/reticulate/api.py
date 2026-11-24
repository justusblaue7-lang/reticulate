"""HTTP API for the Reticulate web client.

Run with `reticulate serve` or `uvicorn reticulate.api:app --reload`.
"""

import asyncio
import logging
import platform
import subprocess
import threading
from collections import defaultdict
from collections.abc import Callable
from contextlib import asynccontextmanager
from functools import cache

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from reticulate import __version__, decision, dialogue, runs
from reticulate import pattern as personal
from reticulate.atlas import runtime as atlas_runtime
from reticulate import config
from reticulate.config import settings
from reticulate.decision.schemas import Decision, Rating
from reticulate.library import Library, default_library
from reticulate.profile import CognitiveProfile, ProfileKind
from reticulate.science import science
from reticulate.simulation import ClaudeEngine, EngineError, Problem, ReasoningEngine
from reticulate.simulation.pipeline import MAX_PROFILES, MAX_REPLICATES, MAX_VALUES, Progress, report_progress


log = logging.getLogger("reticulate")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Records of earlier builds move into the project's data folder, never into a folder
    # set elsewhere (tests use a temporary one).
    if settings().data_dir == config.ROOT_DIR / "data":
        for line in runs.migrate_legacy():
            log.warning("moved into the data folder: %s", line)
    if atlas_runtime.available():
        threading.Thread(target=atlas_runtime.warm, daemon=True).start()
    yield


app = FastAPI(title="Reticulate", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origins, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)


class NotConfigured(RuntimeError):
    pass


CONNECT_HINT = "Connect Claude first: add your Anthropic API key under “Connect Claude” at the top right."

# Runs in flight, by decision id, so that the interface can show their progress.
_running: dict[str, Progress] = {}
# One lock per decision: a change is applied to the latest saved record, never to a stale copy.
_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
# Background analyses; kept so that the tasks are not garbage-collected while they run.
_background: set[asyncio.Task] = set()


@cache
def _claude() -> ClaudeEngine:
    config = settings()
    return ClaudeEngine(model=config.model, effort=config.effort, dialogue_effort=config.dialogue_effort)


def get_engine() -> ReasoningEngine:
    if not settings().claude_configured:
        raise NotConfigured()
    return _claude()


def get_optional_engine() -> ReasoningEngine | None:
    return _claude() if settings().claude_configured else None


def get_library() -> Library:
    return default_library()


ProfileRef = str | CognitiveProfile


def _resolve(library: Library, ref: ProfileRef) -> CognitiveProfile:
    try:
        return library.resolve(ref)
    except KeyError:
        raise HTTPException(404, f"unknown avatar '{ref}'") from None


def _decision(decision_id: str) -> Decision:
    try:
        return runs.load_decision(decision_id)
    except KeyError:
        raise HTTPException(404, f"unknown decision '{decision_id}'") from None


async def _update(decision_id: str, change: Callable[[Decision], Decision]) -> Decision:
    """Apply `change` to the latest saved record and save it. A change that no longer fits
    (the dialogue moved on meanwhile) answers 409."""
    async with _locks[decision_id]:
        try:
            updated = change(_decision(decision_id))
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        runs.save(updated)
        return updated


def _explain(exc: Exception) -> str:
    """A failure of a background step, in words the interface can show."""
    if isinstance(exc, NotConfigured):
        return CONNECT_HINT
    if isinstance(exc, anthropic.AuthenticationError):
        return "Anthropic rejected the API key. Reconnect Claude with a valid key."
    if isinstance(exc, anthropic.RateLimitError):
        return "Claude's rate limit was reached. Try again in a minute."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Claude API."
    if isinstance(exc, anthropic.APIError):
        return f"Claude API error: {exc.message}"
    return str(exc) or exc.__class__.__name__


def _start_analysis(decision_id: str, problem: Problem, engine: ReasoningEngine) -> None:
    """Claude's reading of the decision, in the background while the dialogue goes on."""

    async def job() -> None:
        try:
            result = await decision.analyse(problem, engine)
            change: Callable[[Decision], Decision] = lambda d: decision.with_analysis(d, result)  # noqa: E731
        except Exception as exc:  # any failure is recorded on the decision instead of lost in the task
            message = _explain(exc)
            change = lambda d: decision.with_analysis_failed(d, message)  # noqa: E731
        try:
            await _update(decision_id, change)
        except HTTPException:
            pass  # the decision was deleted meanwhile

    task = asyncio.create_task(job())
    _background.add(task)
    task.add_done_callback(_background.discard)


class MapRequest(BaseModel):
    text: str = Field(min_length=2, max_length=200)


class DecisionRequest(BaseModel):
    problem: Problem
    anatomy: list[Rating] | None = None  # set by hand, without Claude; omit to start the dialogue


class ReplyRequest(BaseModel):
    answer: str | None = Field(default=None, max_length=dialogue.workflow.MAX_ANSWER)
    skip: bool = False


class ReviseRequest(BaseModel):
    index: int = Field(ge=0)


class SettledRequest(BaseModel):
    items: list[str] = Field(max_length=100)


class AnatomyRequest(BaseModel):
    anatomy: list[Rating]


class PanelRequest(BaseModel):
    profiles: list[ProfileRef] = Field(min_length=1, max_length=MAX_PROFILES)
    replicates: int = Field(default=3, ge=1, le=MAX_REPLICATES)
    neural_context: bool = True


class ClaudeKey(BaseModel):
    api_key: str = Field(min_length=20, max_length=400)


class TippingRequest(BaseModel):
    profile: ProfileRef
    keys: list[str] = Field(min_length=1, max_length=3, description="dimension or trait ids")
    values: list[float] = Field(default=[2, 5, 8], min_length=2, max_length=MAX_VALUES)
    replicates: int = Field(default=2, ge=1, le=MAX_REPLICATES)


@app.exception_handler(NotConfigured)
async def _not_configured(_: Request, __: NotConfigured) -> JSONResponse:
    return JSONResponse({"detail": CONNECT_HINT}, status_code=503)


@app.exception_handler(EngineError)
async def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=502)


@app.exception_handler(anthropic.APIError)
async def _anthropic_error(_: Request, exc: anthropic.APIError) -> JSONResponse:
    if isinstance(exc, anthropic.AuthenticationError):
        return JSONResponse(
            {"detail": "Anthropic rejected the API key. Reconnect Claude with a valid key (top right)."}, status_code=503
        )
    if isinstance(exc, anthropic.RateLimitError):
        return JSONResponse({"detail": "Claude rate limit reached; retry shortly or use fewer replicates"}, status_code=429)
    if isinstance(exc, anthropic.APIConnectionError):
        return JSONResponse({"detail": "Could not reach the Claude API"}, status_code=503)
    return JSONResponse({"detail": f"Claude API error: {exc.message}"}, status_code=502)


@app.get("/api/status")
def status() -> dict:
    config = settings()
    return {
        "version": __version__,
        "science_version": science().version,
        "claude": {
            "configured": config.claude_configured,
            "model": config.model,
            "effort": config.effort,
            "dialogue_effort": config.dialogue_effort,
            "key_hint": config.key_hint,
        },
        "literature": atlas_runtime.available(),
        "data_dir": _relative(settings().data_dir),
    }


def _relative(path) -> str:
    try:
        return str(path.relative_to(config.ROOT_DIR))
    except ValueError:
        return str(path)


@app.get("/api/science")
def get_science() -> dict:
    """Dimensions, personality, structures, networks, findings, stimuli, decision features,
    mechanisms and references in one call."""
    return science().model_dump(mode="json")


# ---- the person's own pattern --------------------------------------------------------------


@app.get("/api/pattern")
def get_pattern() -> personal.PersonalPattern | None:
    """The person's self-rated pattern, or null before they have rated themselves."""
    return personal.load(settings().pattern_file)


@app.put("/api/pattern")
def put_pattern(request: personal.PatternRequest) -> personal.PersonalPattern:
    """Score the self-rating (and any adjustments) and save it. Dialogues already started keep
    the pattern they began with; new dialogues use this one."""
    try:
        result = personal.build(request)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return personal.save(settings().pattern_file, result)


@app.delete("/api/pattern")
def delete_pattern() -> dict:
    return {"deleted": personal.delete(settings().pattern_file)}


@app.put("/api/settings/claude")
async def connect_claude(request: ClaudeKey) -> dict:
    """Check a key against the Models API, then keep it in engine/.env."""
    key = request.api_key.strip()
    model = settings().model
    if not key.startswith("sk-ant-"):
        raise HTTPException(422, "That is not an Anthropic API key; those start with “sk-ant-”.")
    try:
        await anthropic.AsyncAnthropic(api_key=key).models.retrieve(model)
    except anthropic.AuthenticationError:
        raise HTTPException(401, "Anthropic did not accept this key. Copy it again from the Claude Console.") from None
    except (anthropic.PermissionDeniedError, anthropic.NotFoundError):
        raise HTTPException(403, f"This key has no access to {model}.") from None
    except anthropic.APIConnectionError:
        raise HTTPException(503, "Could not reach Anthropic to check the key. Check the internet connection.") from None
    config.store_api_key(key)
    _claude.cache_clear()
    return status()


@app.delete("/api/settings/claude")
def disconnect_claude() -> dict:
    config.store_api_key(None)
    _claude.cache_clear()
    return status()


# ---- avatars ----------------------------------------------------------------------------


@app.get("/api/avatars")
def list_avatars(library: Library = Depends(get_library)) -> list[CognitiveProfile]:
    return library.list()


@app.post("/api/avatars")
def save_avatar(profile: CognitiveProfile, library: Library = Depends(get_library)) -> CognitiveProfile:
    """Create or update one of the user's avatars; a copy of a persona gets a new id."""
    existing = next((p for p in library.list() if p.id == profile.id), None)
    if existing is None or existing.origin == "library":
        profile = profile.model_copy(update={"id": library.new_id(profile.name)})
    profile = profile.model_copy(update={"kind": ProfileKind.PERSONA})
    try:
        return library.save(profile)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.delete("/api/avatars/{avatar_id}")
def delete_avatar(avatar_id: str, library: Library = Depends(get_library)) -> dict:
    try:
        library.delete(avatar_id)
    except KeyError:
        raise HTTPException(404, f"unknown avatar '{avatar_id}'") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"deleted": avatar_id}


# ---- maps -------------------------------------------------------------------------------


@app.post("/api/maps")
def text_map(request: MapRequest) -> dict:
    """Meta-analytic maps for a text: NeuroQuery always, Neurosynth when it is one of its terms."""
    try:
        return atlas_runtime.text_map(request.text)
    except atlas_runtime.AtlasUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


# ---- decisions --------------------------------------------------------------------------


@app.get("/api/decisions")
def list_decisions() -> list[runs.RunSummary]:
    return runs.list_runs("decision")


@app.get("/api/decisions/{decision_id}")
def get_decision(decision_id: str) -> Decision:
    return _decision(decision_id)


@app.delete("/api/decisions/{decision_id}")
def delete_decision(decision_id: str) -> dict:
    try:
        runs.delete(decision_id)
    except KeyError:
        raise HTTPException(404, f"unknown decision '{decision_id}'") from None
    return {"deleted": decision_id}


@app.post("/api/decisions")
async def create_decision(
    request: DecisionRequest, engine: ReasoningEngine | None = Depends(get_optional_engine)
) -> Decision:
    """A new decision. Rated by hand it needs no Claude; otherwise the dialogue is ready for
    its first question (POST …/dialogue) and Claude's analysis starts in the background."""
    if request.anatomy is None and engine is None:
        raise NotConfigured()
    held = personal.snapshot(personal.load(settings().pattern_file)) if request.anatomy is None else None
    result = decision.create(request.problem, engine, request.anatomy, held)
    runs.save(result)
    if request.anatomy is None:
        _start_analysis(result.id, result.problem, engine)
    return result


@app.post("/api/decisions/{decision_id}/analysis")
async def analyse_decision(decision_id: str, engine: ReasoningEngine = Depends(get_engine)) -> Decision:
    """Start (or retry) Claude's analysis of the decision in the background."""
    current = _decision(decision_id)
    if current.analysis == "pending":
        return current
    updated = await _update(decision_id, lambda d: d.model_copy(update={"analysis": "pending", "analysis_error": None}))
    _start_analysis(decision_id, current.problem, engine)
    return updated


# ---- the dialogue -----------------------------------------------------------------------


@app.post("/api/decisions/{decision_id}/dialogue")
async def reply(decision_id: str, request: ReplyRequest, engine: ReasoningEngine = Depends(get_engine)) -> Decision:
    """Answer the open question (or skip it) and get the next one. Without an open question
    this asks the next one, which starts the dialogue or retries after a failed call."""

    def answered(d: Decision) -> Decision:
        if d.dialogue is None:
            # The dialogue holds the person's pattern as it is now, for every turn to come.
            snapshot = personal.snapshot(personal.load(settings().pattern_file))
            d = d.model_copy(update={"dialogue": dialogue.new_dialogue(engine, snapshot)})
        if d.dialogue.conclusion is not None:
            raise ValueError("the dialogue is concluded; reopen it to continue")
        if d.dialogue.open is not None:
            return dialogue.record_answer(d, request.answer, request.skip)
        if request.answer or request.skip:
            raise ValueError("there is no open question to answer")
        return d

    current = await _update(decision_id, answered)
    expected = len(current.dialogue.exchanges)
    try:
        turn, usage = await dialogue.next_turn(current, engine)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return await _update(decision_id, lambda d: dialogue.add_turn(d, turn, usage, expected))


@app.post("/api/decisions/{decision_id}/dialogue/conclude")
async def conclude(decision_id: str, request: ReplyRequest, engine: ReasoningEngine = Depends(get_engine)) -> Decision:
    """Put the decision into words: what the person chose, why, and the first step."""

    def answered(d: Decision) -> Decision:
        if d.dialogue is None or not d.dialogue.exchanges:
            raise ValueError("there is nothing to conclude yet")
        if d.dialogue.open is not None and request.answer:
            return dialogue.record_answer(d, request.answer)
        return d

    current = await _update(decision_id, answered)
    expected = len(current.dialogue.exchanges)
    result, usage = await dialogue.conclusion(current, engine)
    return await _update(decision_id, lambda d: dialogue.conclude(d, result, usage, expected))


@app.post("/api/decisions/{decision_id}/dialogue/revise")
async def revise(decision_id: str, request: ReviseRequest) -> Decision:
    """Go back to an earlier question; its answer and everything after it are dropped."""
    return await _update(decision_id, lambda d: dialogue.revise(d, request.index))


@app.post("/api/decisions/{decision_id}/dialogue/reopen")
async def reopen(decision_id: str) -> Decision:
    return await _update(decision_id, dialogue.reopen)


@app.put("/api/decisions/{decision_id}/settled")
async def settle(decision_id: str, request: SettledRequest) -> Decision:
    """The open questions the person has ticked off."""
    items = list(dict.fromkeys(i.strip() for i in request.items if i.strip()))
    return await _update(decision_id, lambda d: d.model_copy(update={"settled": items}))


@app.post("/api/decisions/{decision_id}/reveal")
def reveal(decision_id: str) -> dict:
    """Show the decision's folder in Finder (macOS); always returns its path."""
    try:
        folder = runs.folder(decision_id)
    except KeyError:
        raise HTTPException(404, f"unknown decision '{decision_id}'") from None
    if platform.system() == "Darwin":
        subprocess.run(["open", "-R", str(folder / runs.READABLE)], check=False)
    return {"path": _relative(folder)}


@app.get("/api/decisions/{decision_id}/progress")
def decision_progress(decision_id: str) -> dict | None:
    """Progress of the panel or tipping run in flight for this decision, or null."""
    progress = _running.get(decision_id)
    if progress is None:
        return None
    return {
        "kind": progress.kind,
        "total": progress.total,
        "done": progress.done,
        "labels": progress.labels,
        "started_at": progress.started_at.isoformat(),
    }


@app.put("/api/decisions/{decision_id}/anatomy")
async def update_anatomy(decision_id: str, request: AnatomyRequest) -> Decision:
    return await _update(decision_id, lambda d: decision.update_anatomy(d, request.anatomy))


@app.post("/api/decisions/{decision_id}/panel")
async def convene_panel(
    decision_id: str,
    request: PanelRequest,
    library: Library = Depends(get_library),
    engine: ReasoningEngine = Depends(get_engine),
) -> Decision:
    profiles = [_resolve(library, ref) for ref in request.profiles]
    current = _decision(decision_id)
    progress = Progress("panel", decision.panel_calls(current, len(profiles), request.replicates))
    _running[decision_id] = progress
    try:
        with report_progress(progress):
            result = await decision.run_panel(
                current, profiles, engine, replicates=request.replicates, neural_context=request.neural_context
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        _running.pop(decision_id, None)
    return await _update(decision_id, lambda d: decision.with_panel(d, result))


@app.post("/api/decisions/{decision_id}/tipping")
async def tipping_points(
    decision_id: str,
    request: TippingRequest,
    library: Library = Depends(get_library),
    engine: ReasoningEngine = Depends(get_engine),
) -> Decision:
    profile = _resolve(library, request.profile)
    current = _decision(decision_id)
    calls = decision.tipping_calls(current, len(request.keys), len(set(request.values)), request.replicates)
    progress = Progress("tipping", calls)
    _running[decision_id] = progress
    try:
        with report_progress(progress):
            results = await decision.run_tipping(
                current, profile, request.keys, request.values, engine, replicates=request.replicates
            )
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        _running.pop(decision_id, None)
    return await _update(decision_id, lambda d: decision.with_tipping(d, profile, results))

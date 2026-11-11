"""HTTP API for the Reticulate web client.

Run with `reticulate serve` or `uvicorn reticulate.api:app --reload`.
"""

import threading
from contextlib import asynccontextmanager
from functools import cache

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from reticulate import __version__, decision, runs
from reticulate.atlas import runtime as atlas_runtime
from reticulate import config
from reticulate.config import settings
from reticulate.decision.schemas import Decision, Rating
from reticulate.library import Library, default_library
from reticulate.profile import CognitiveProfile, ProfileKind
from reticulate.science import science
from reticulate.simulation import ClaudeEngine, EngineError, Problem, ReasoningEngine
from reticulate.simulation.pipeline import MAX_PROFILES, MAX_REPLICATES, MAX_VALUES, Progress, report_progress


@asynccontextmanager
async def lifespan(_: FastAPI):
    if atlas_runtime.available():
        threading.Thread(target=atlas_runtime.warm, daemon=True).start()
    yield


app = FastAPI(title="Reticulate", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origins, allow_methods=["*"], allow_headers=["*"])


class NotConfigured(RuntimeError):
    pass


CONNECT_HINT = "Connect Claude first: add your Anthropic API key under “Connect Claude” at the top right."

# Runs in flight, by decision id, so that the interface can show their progress.
_running: dict[str, Progress] = {}


@cache
def _claude() -> ClaudeEngine:
    config = settings()
    return ClaudeEngine(model=config.model, effort=config.effort)


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


class MapRequest(BaseModel):
    text: str = Field(min_length=2, max_length=200)


class DecisionRequest(BaseModel):
    problem: Problem
    anatomy: list[Rating] | None = None  # set by hand; omit to let Claude rate it


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
            "key_hint": config.key_hint,
        },
        "literature": atlas_runtime.available(),
    }


@app.get("/api/science")
def get_science() -> dict:
    """Dimensions, personality, structures, networks, findings, stimuli, decision features,
    mechanisms and references in one call."""
    return science().model_dump(mode="json")


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
    if request.anatomy is None and engine is None:
        raise NotConfigured()
    result = await decision.create(request.problem, engine, request.anatomy)
    runs.save(result)
    return result


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
def update_anatomy(decision_id: str, request: AnatomyRequest) -> Decision:
    result = decision.update_anatomy(_decision(decision_id), request.anatomy)
    runs.save(result)
    return result


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
            result = await decision.convene(
                current, profiles, engine, replicates=request.replicates, neural_context=request.neural_context
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        _running.pop(decision_id, None)
    runs.save(result)
    return result


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
            result = await decision.tipping_points(
                current, profile, request.keys, request.values, engine, replicates=request.replicates
            )
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        _running.pop(decision_id, None)
    runs.save(result)
    return result

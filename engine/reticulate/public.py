"""The public engine, as served on reticulate.space.

Stateless: it stores nothing. Each visitor brings their own Anthropic key, sent with every
request in the `x-anthropic-key` header and used for that request only, never logged or kept.
A visitor without one gets a few free decisions on the house key (reticulate.trial).
Their decisions, pattern and avatars live in their own browser; a request carries the
decision it works on and gets the updated decision back, with its summary for the list.

The local app (reticulate.api) keeps its files and its own key; this module only reuses the
same workflows.
"""

from __future__ import annotations


import anthropic
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from reticulate import __version__, decision, dialogue, runs, trial
from reticulate import pattern as personal
from reticulate.api import (
    AnatomyRequest,
    ClaudeKey,
    PanelRequest,
    ReplyRequest,
    ReviseRequest,
    SettledRequest,
    _anthropic_error,
    _engine_error,
    _explain,
)
from reticulate.config import settings
from reticulate.decision.schemas import Decision, Rating
from reticulate.library import Library
from reticulate.profile import CognitiveProfile, ProfileKind
from reticulate.science import science
from reticulate.simulation import ClaudeEngine, EngineError, Problem, ReasoningEngine

app = FastAPI(title="Reticulate (public)", version=__version__, docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_exception_handler(EngineError, _engine_error)
app.add_exception_handler(anthropic.APIError, _anthropic_error)

NO_KEY = "Connect Claude first: add your own Anthropic API key under “Connect Claude” at the top right."
TRIAL_USED = (
    "Your free decisions are used up. To keep going, add your own Anthropic API key under “Connect Claude”: "
    "it runs on your account, at a few cents a decision."
)
TRIAL_EXPIRED = "This free decision is past its {days} days. To go on with it, add your own Anthropic API key under “Connect Claude”."
TRIAL_BUSY = "Too many free requests from your network just now. Wait a while, or add your own Anthropic API key under “Connect Claude”."


def make_engine(key: str) -> ReasoningEngine:
    config = settings()
    # max_retries: a visitor waits on this request, so fail fast and let them retry.
    client = anthropic.AsyncAnthropic(api_key=key, max_retries=2)
    return ClaudeEngine(model=config.model, effort=config.effort, dialogue_effort=config.dialogue_effort, client=client)


class Claude:
    """Which key a request runs on: the visitor's own, or the house key for a free decision."""

    def __init__(self, key: str | None, ip: str):
        key = (key or "").strip()
        self.own = key if key.startswith("sk-ant-") else None
        self.ip = ip

    def _house(self) -> ReasoningEngine:
        house = trial.house_key()
        if house is None:
            raise HTTPException(401, NO_KEY)
        if not trial.allow(self.ip):
            raise HTTPException(429, TRIAL_BUSY)
        return make_engine(house)

    def for_decision(self, d: Decision) -> ReasoningEngine:
        """The visitor's key, or the house key while the decision's free grant holds."""
        if self.own:
            return make_engine(self.own)
        held = trial.granted(d.id, d.trial_grant) if trial.offered() else None
        if held is None:
            raise HTTPException(401, NO_KEY)
        if not held:
            raise HTTPException(402, TRIAL_EXPIRED.format(days=trial.days()))
        return self._house()

    def for_new(self, token: str | None) -> tuple[ReasoningEngine, trial.Pass | None]:
        """The engine for a new decision and, on the house key, the visitor's pass with it spent."""
        if self.own:
            return make_engine(self.own), None
        if not trial.offered():
            raise HTTPException(401, NO_KEY)
        current = trial.read_pass(token)
        if current.left <= 0:
            raise HTTPException(402, TRIAL_USED)
        return self._house(), trial.spend(current)


def get_claude(request: Request, x_anthropic_key: str | None = Header(default=None)) -> Claude:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return Claude(x_anthropic_key, forwarded or (request.client.host if request.client else "unknown"))


_LIBRARY = Library.load()  # the built-in personas only; a visitor's own avatars come inline


def _resolve(ref: str | CognitiveProfile) -> CognitiveProfile:
    try:
        return _LIBRARY.resolve(ref)
    except KeyError:
        raise HTTPException(404, f"unknown avatar '{ref}'") from None


class TrialPass(BaseModel):
    token: str
    used: int
    left: int


class Result(BaseModel):
    decision: Decision
    summary: runs.RunSummary
    trial: TrialPass | None = None  # the visitor's pass, when this spent a free decision


def _result(d: Decision, spent: trial.Pass | None = None) -> Result:
    data = d.model_dump(mode="json")
    p = TrialPass(token=spent.token, used=spent.used, left=spent.left) if spent else None
    return Result(decision=d, summary=runs._summary(settings().data_dir / f"{d.id}.json", data), trial=p)


def _apply(d: Decision, change) -> Decision:
    try:
        return change(d)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


# ---- reference ---------------------------------------------------------------------------


@app.get("/api/status")
def status() -> dict:
    config = settings()
    return {
        "version": __version__,
        "science_version": science().version,
        "public": True,
        "claude": {
            "configured": False,  # the browser knows whether it holds a key
            "model": config.model,
            "effort": config.effort,
            "dialogue_effort": config.dialogue_effort,
            "key_hint": None,
        },
        "literature": False,
        "data_dir": "this browser",
        "trial": trial.offered(),
    }


@app.get("/api/science")
def get_science() -> dict:
    return science().model_dump(mode="json")


@app.get("/api/avatars")
def list_avatars() -> list[CognitiveProfile]:
    return _LIBRARY.list()


class AvatarCheck(BaseModel):
    profile: CognitiveProfile


@app.post("/api/avatar")
def check_avatar(request: AvatarCheck) -> CognitiveProfile:
    """Validate a visitor's own avatar; a copy of a built-in persona gets a new id."""
    profile = request.profile
    if profile.origin == "library" or any(p.id == profile.id for p in _LIBRARY.list()):
        profile = profile.model_copy(update={"id": _LIBRARY.new_id(profile.name)})
    return profile.model_copy(update={"kind": ProfileKind.PERSONA, "origin": "user"})


@app.post("/api/pattern")
def score_pattern(request: personal.PatternRequest) -> personal.PersonalPattern:
    try:
        return personal.build(request)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post("/api/key")
async def check_key(request: ClaudeKey) -> dict:
    """Check a visitor's key against the Models API. Nothing is stored."""
    key = request.api_key.strip()
    model = settings().model
    if not key.startswith("sk-ant-"):
        raise HTTPException(422, "That is not an Anthropic API key; those start with “sk-ant-”.")
    try:
        await anthropic.AsyncAnthropic(api_key=key, max_retries=1).models.retrieve(model)
    except anthropic.AuthenticationError:
        raise HTTPException(401, "Anthropic did not accept this key. Copy it again from the Claude Console.") from None
    except (anthropic.PermissionDeniedError, anthropic.NotFoundError):
        raise HTTPException(403, f"This key has no access to {model}.") from None
    except anthropic.APIConnectionError:
        raise HTTPException(503, "Could not reach Anthropic to check the key.") from None
    return {"ok": True, "model": model, "key_hint": f"…{key[-4:]}"}


# ---- decisions ---------------------------------------------------------------------------


class NewRequest(BaseModel):
    problem: Problem
    anatomy: list[Rating] | None = None
    pattern: personal.PersonalPattern | None = None


class On(BaseModel):
    decision: Decision


class ReplyOn(ReplyRequest):
    decision: Decision
    pattern: personal.PersonalPattern | None = None


class ConcludeOn(ReplyRequest):
    decision: Decision


class ReviseOn(ReviseRequest):
    decision: Decision


class SettledOn(SettledRequest):
    decision: Decision


class AnatomyOn(AnatomyRequest):
    decision: Decision


class PanelOn(PanelRequest):
    decision: Decision


@app.post("/api/decision/new")
def new_decision(
    request: NewRequest, claude: Claude = Depends(get_claude), x_reticulate_trial: str | None = Header(default=None)
) -> Result:
    """A new decision. Rated by hand it needs no Claude; otherwise the browser asks for the
    analysis (…/analyse) and the first question (…/reply) next. Without a key of the visitor's
    own it is one of their free decisions, if any are left."""
    if request.anatomy is not None:
        return _result(decision.create(request.problem, None, request.anatomy, None))
    engine, spent = claude.for_new(x_reticulate_trial)
    created = decision.create(request.problem, engine, None, personal.snapshot(request.pattern))
    update: dict = {"analysis": "pending"}
    if spent:
        update["trial_grant"] = trial.grant(created.id)
    return _result(created.model_copy(update=update), spent)


class Analysed(BaseModel):
    analysis: decision.workflow.Analysis | None = None
    error: str | None = None


@app.post("/api/decision/analyse")
async def analyse(request: On, claude: Claude = Depends(get_claude)) -> Analysed:
    """Claude's reading of the decision. It takes a while, and the dialogue goes on meanwhile,
    so it comes back on its own; the browser applies it to the decision as it is by then
    (…/apply-analysis). A failure comes back as words to show, as in the local app."""
    engine = claude.for_decision(request.decision)
    try:
        return Analysed(analysis=await decision.analyse(request.decision.problem, engine))
    except Exception as exc:  # noqa: BLE001
        return Analysed(error=_explain(exc))


class ApplyAnalysis(Analysed):
    decision: Decision


@app.post("/api/decision/apply-analysis")
def apply_analysis(request: ApplyAnalysis) -> Result:
    d = request.decision
    if request.analysis is not None:
        return _result(decision.with_analysis(d, request.analysis))
    return _result(decision.with_analysis_failed(d, request.error or "The analysis failed."))


@app.post("/api/decision/reply")
async def reply(request: ReplyOn, claude: Claude = Depends(get_claude)) -> Result:
    engine = claude.for_decision(request.decision)

    def answered(d: Decision) -> Decision:
        if d.dialogue is None:
            d = d.model_copy(update={"dialogue": dialogue.new_dialogue(engine, personal.snapshot(request.pattern))})
        if d.dialogue.conclusion is not None:
            raise ValueError("the dialogue is concluded; reopen it to continue")
        if d.dialogue.open is not None:
            return dialogue.record_answer(d, request.answer, request.skip)
        if request.answer or request.skip:
            raise ValueError("there is no open question to answer")
        return d

    current = _apply(request.decision, answered)
    expected = len(current.dialogue.exchanges)
    try:
        turn, usage = await dialogue.next_turn(current, engine)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return _result(_apply(current, lambda d: dialogue.add_turn(d, turn, usage, expected)))


@app.post("/api/decision/conclude")
async def conclude(request: ConcludeOn, claude: Claude = Depends(get_claude)) -> Result:
    engine = claude.for_decision(request.decision)

    def answered(d: Decision) -> Decision:
        if d.dialogue is None or not d.dialogue.exchanges:
            raise ValueError("there is nothing to conclude yet")
        if d.dialogue.open is not None and request.answer:
            return dialogue.record_answer(d, request.answer)
        return d

    current = _apply(request.decision, answered)
    expected = len(current.dialogue.exchanges)
    result, usage = await dialogue.conclusion(current, engine)
    return _result(_apply(current, lambda d: dialogue.conclude(d, result, usage, expected)))


@app.post("/api/decision/revise")
def revise(request: ReviseOn) -> Result:
    return _result(_apply(request.decision, lambda d: dialogue.revise(d, request.index)))


@app.post("/api/decision/reopen")
def reopen(request: On) -> Result:
    return _result(_apply(request.decision, dialogue.reopen))


@app.post("/api/decision/settle")
def settle(request: SettledOn) -> Result:
    items = list(dict.fromkeys(i.strip() for i in request.items if i.strip()))
    return _result(request.decision.model_copy(update={"settled": items}))


@app.post("/api/decision/anatomy")
def anatomy(request: AnatomyOn) -> Result:
    return _result(_apply(request.decision, lambda d: decision.update_anatomy(d, request.anatomy)))


@app.post("/api/decision/panel")
async def panel(request: PanelOn, claude: Claude = Depends(get_claude)) -> Result:
    engine = claude.for_decision(request.decision)
    profiles = [_resolve(ref) for ref in request.profiles]
    # On the house key: each mind once, and at most six of them.
    free = claude.own is None
    if free and len(profiles) > 6:
        raise HTTPException(422, "A free decision can ask up to six minds at once.")
    try:
        result = await decision.run_panel(
            request.decision,
            profiles,
            engine,
            replicates=1 if free else request.replicates,
            neural_context=request.neural_context,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return _result(decision.with_panel(request.decision, result))


@app.exception_handler(HTTPException)
async def _http(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

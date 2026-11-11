"""Decision simulation: question -> frame -> perspectives (× replicates) -> analysis.

A frame and a neural context can be passed in, as the decision mode does after its
analysis step; otherwise the frame is extracted here and no neural context is used.
"""

import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime

from reticulate import __version__
from reticulate.config import settings
from reticulate.profile import CognitiveProfile
from reticulate.science import science
from reticulate.simulation.compare import compare, dose_response, tally
from reticulate.simulation.engines import ReasoningEngine, total, track_usage
from reticulate.simulation.prompts import PROMPT_VERSION
from reticulate.simulation.schemas import (
    DecisionFrame,
    Perspective,
    Problem,
    RunMeta,
    SensitivityResult,
    SimulationResult,
    Usage,
)

MAX_PROFILES = 8
MAX_REPLICATES = 5
MAX_VALUES = 6


@dataclass
class Progress:
    """Live progress of a run, read by the API while the run is in flight."""

    kind: str
    total: int  # engine calls planned
    done: int = 0
    labels: dict[str, int] = field(default_factory=dict)  # job label -> replicates finished
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def tick(self, label: str | None = None) -> None:
        self.done += 1
        if label is not None:
            self.labels[label] = self.labels.get(label, 0) + 1


_progress: ContextVar[Progress | None] = ContextVar("reticulate_progress", default=None)


@contextmanager
def report_progress(progress: Progress) -> Iterator[Progress]:
    """Count the engine calls of every run inside the block into `progress`."""
    token = _progress.set(progress)
    try:
        yield progress
    finally:
        _progress.reset(token)


def _tick(label: str | None = None) -> None:
    progress = _progress.get()
    if progress is not None:
        progress.tick(label)


def _meta(engine: ReasoningEngine, replicates: int, context: str | None, usage: Usage) -> RunMeta:
    return RunMeta(
        app_version=__version__,
        science_version=science().version,
        prompt_version=PROMPT_VERSION,
        engine=engine.name,
        model=getattr(engine, "model", None),
        effort=getattr(engine, "effort", None),
        replicates=replicates,
        neural_context=bool(context),
        usage=usage if usage.calls else None,
    )


async def _perspectives(
    problem: Problem,
    frame: DecisionFrame,
    jobs: list[tuple[str, CognitiveProfile]],
    engine: ReasoningEngine,
    replicates: int,
    context: str | None,
) -> dict[str, list[Perspective]]:
    """Run every (label, profile) job `replicates` times with bounded concurrency."""
    gate = asyncio.Semaphore(settings().concurrency)

    async def one(label: str, profile: CognitiveProfile) -> Perspective:
        async with gate:
            perspective = await engine.perspective(problem, frame, profile, context)
        _tick(label)
        return perspective

    tasks = {label: [asyncio.create_task(one(label, p)) for _ in range(replicates)] for label, p in jobs}
    return {label: list(await asyncio.gather(*ts)) for label, ts in tasks.items()}


async def _framed(problem: Problem, engine: ReasoningEngine) -> DecisionFrame:
    frame = await engine.frame(problem)
    _tick("frame")
    return frame


def _check(replicates: int) -> None:
    if not 1 <= replicates <= MAX_REPLICATES:
        raise ValueError(f"replicates must be between 1 and {MAX_REPLICATES}")


async def simulate(
    problem: Problem,
    profiles: list[CognitiveProfile],
    engine: ReasoningEngine,
    *,
    replicates: int = 1,
    synthesize: bool = True,
    frame: DecisionFrame | None = None,
    context: str | None = None,
) -> SimulationResult:
    _check(replicates)
    if not 1 <= len(profiles) <= MAX_PROFILES:
        raise ValueError(f"a simulation takes 1–{MAX_PROFILES} profiles")
    ids = [p.id for p in profiles]
    if len(set(ids)) != len(ids):
        raise ValueError("profile ids in a simulation must be unique")

    with track_usage() as calls:
        frame = frame or await _framed(problem, engine)
        perspectives = await _perspectives(problem, frame, [(p.id, p) for p in profiles], engine, replicates, context)
        space = compare(frame, ids, perspectives)
        synthesis = None
        if synthesize and len(profiles) > 1:
            first = {pid: views[0] for pid, views in perspectives.items()}
            synthesis = await engine.synthesize(problem, frame, profiles, first, space, context)
            _tick("synthesis")
    return SimulationResult(
        id=uuid.uuid4().hex,
        created_at=datetime.now(UTC),
        meta=_meta(engine, replicates, context, total(calls)),
        problem=problem,
        frame=frame,
        profiles=profiles,
        perspectives=perspectives,
        space=space,
        synthesis=synthesis,
    )


async def sensitivity(
    problem: Problem,
    profile: CognitiveProfile,
    key: str,
    values: list[float],
    engine: ReasoningEngine,
    *,
    replicates: int = 1,
    frame: DecisionFrame | None = None,
    context: str | None = None,
) -> SensitivityResult:
    """Dose–response: vary one dimension or trait of one profile, everything else held fixed."""
    _check(replicates)
    profile.value(key)  # KeyError for unknown dimensions and traits
    values = sorted({float(v) for v in values})
    if not 2 <= len(values) <= MAX_VALUES or any(not 0 <= v <= 10 for v in values):
        raise ValueError(f"give 2–{MAX_VALUES} distinct values between 0 and 10")

    with track_usage() as calls:
        frame = frame or await _framed(problem, engine)
        jobs = [(f"{v:g}", profile.with_value(key, v)) for v in values]
        perspectives = await _perspectives(problem, frame, jobs, engine, replicates, context)
    return SensitivityResult(
        id=uuid.uuid4().hex,
        created_at=datetime.now(UTC),
        meta=_meta(engine, replicates, context, total(calls)),
        problem=problem,
        frame=frame,
        profile=profile,
        dimension=key,
        values=values,
        perspectives=perspectives,
        curves=dose_response(frame, values, perspectives),
        recommendations={label: tally(views) for label, views in perspectives.items()},
    )

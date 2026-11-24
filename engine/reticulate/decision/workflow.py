"""The workflow behind a decision, beside its Socratic dialogue (reticulate.dialogue).

1. Analyse. Claude structures the decision (options, facts, unknowns, factors), rates its
   anatomy and writes a watch-out for every mechanism the anatomy engages, in one call. It
   runs in the background while the dialogue starts. Without Claude, the anatomy can be
   set by hand.
2. Neural signature. Deterministic: the level-weighted composite of the features'
   meta-analytic maps in both sources, the structures and networks it engages, its overlap
   with the dimensions' construct maps, its decoding against the vocabulary, and the
   mechanisms and published findings that bear on it.
3. Panel. Every avatar reasons through the decision in replicates, with the neural context
   unless it is switched off; the perspectives are compared and synthesised. Its result
   goes back into the dialogue as a perspective to question.
4. Tipping points. Dose–response runs on the dimensions the decision engages most; runs
   accumulate, and re-running an avatar and dimension replaces the earlier run.

Steps that call the engine (`analyse`, `run_panel`, `run_tipping`) only read the decision;
the `with_*` functions apply their results to the latest saved record and return a copy.
"""

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel

from reticulate import __version__
from reticulate.atlas import runtime
from reticulate.decision.schemas import (
    Decision,
    DecisionMeta,
    DimensionRelevance,
    EngagedMechanism,
    NeuralSignature,
    Rating,
    SignatureSource,
    SourceAgreement,
)
from reticulate.profile import CognitiveProfile
from reticulate.science import science
from reticulate.simulation import prompts
from reticulate.simulation.engines import ReasoningEngine, total, track_usage
from reticulate.simulation.pipeline import sensitivity, simulate
from reticulate.simulation.schemas import (
    DecisionFrame,
    FeatureRating,
    Problem,
    SensitivityResult,
    SimulationResult,
    Usage,
    WatchOut,
)

MAX_FINDINGS = 8
MAX_TIPPING_DIMENSIONS = 3


def normalise_anatomy(ratings: list[FeatureRating | Rating], source: str) -> list[Rating]:
    """One rating per feature, in the order of the science layer; unknown ids are dropped."""
    known = {f.id for f in science().features}
    rated: dict[str, Rating] = {}
    for r in ratings:
        if r.feature_id in known and r.feature_id not in rated:
            rated[r.feature_id] = Rating(
                feature_id=r.feature_id,
                level=max(0, min(3, r.level)),
                reason=r.reason,
                source=getattr(r, "source", source),
            )
    return [rated.get(f.id, Rating(feature_id=f.id, level=0, source=source)) for f in science().features]


def normalise_watch_outs(notes: list[WatchOut]) -> list[WatchOut]:
    """One watch-out per known mechanism, in the order Claude wrote them; a check only where the
    mechanism has a proven remedy."""
    remedies = {m.id: m.countermove is not None for m in science().mechanisms}
    seen: dict[str, WatchOut] = {}
    for note in notes:
        if note.mechanism_id in remedies and note.mechanism_id not in seen:
            seen[note.mechanism_id] = note if remedies[note.mechanism_id] else note.model_copy(update={"check": ""})
    return list(seen.values())


def _has_map(feature_id: str) -> bool:
    f = science().feature(feature_id)
    return bool(f.neuroquery or f.neurosynth)


def signature(anatomy: list[Rating]) -> NeuralSignature:
    sci = science()
    rated = [r for r in anatomy if r.level > 0]
    weights = {r.feature_id: round(r.level / 3, 3) for r in rated if _has_map(r.feature_id)}

    composite = None
    if weights and runtime.available():
        composite = runtime.composite({f"feature.{k}": w for k, w in weights.items()})
    sources = {
        source: SignatureSource(**composite[source]) if composite and composite.get(source) else None
        for source in ("neuroquery", "neurosynth")
    }
    agreement = SourceAgreement(**composite["agreement"]) if composite and composite.get("agreement") else None

    total_weight = sum(r.level for r in rated) or 1
    dimensions = []
    for d in sci.dimensions:
        engaging = [r for r in rated if d.id in sci.feature(r.feature_id).dimensions]
        overlap = {s: part.constructs[d.id] for s, part in sources.items() if part and d.id in part.constructs}
        dimensions.append(
            DimensionRelevance(
                dimension_id=d.id,
                weight=round(sum(r.level for r in engaging) / total_weight, 3),
                features=[r.feature_id for r in engaging],
                overlap=overlap,
            )
        )
    dimensions.sort(key=lambda d: (-d.weight, -max(d.overlap.values(), default=0)))

    engaged: dict[str, EngagedMechanism] = {}
    for r in sorted(rated, key=lambda r: -r.level):
        for m in sci.feature(r.feature_id).mechanisms:
            item = engaged.setdefault(m, EngagedMechanism(mechanism_id=m, level=r.level, features=[]))
            item.features.append(r.feature_id)
    mechanisms = sorted(engaged.values(), key=lambda m: (-m.level, -len(m.features)))

    relevant = {d.dimension_id: d.weight for d in dimensions if d.weight > 0}
    top = {
        s.key.rpartition(".")[2]
        for part in sources.values()
        if part
        for s in part.top_regions
    }
    candidates = [i for i, link in enumerate(sci.links) if link.dimension in relevant]
    candidates.sort(key=lambda i: (sci.links[i].region not in top, -relevant[sci.links[i].dimension]))

    return NeuralSignature(
        weights=weights,
        neuroquery=sources["neuroquery"],
        neurosynth=sources["neurosynth"],
        agreement=agreement,
        dimensions=dimensions,
        mechanisms=mechanisms,
        findings=candidates[:MAX_FINDINGS],
        unmapped=[r.feature_id for r in rated if not _has_map(r.feature_id)],
        available=runtime.available(),
    )


def _meta(engine: ReasoningEngine | None) -> DecisionMeta:
    return DecisionMeta(
        app_version=__version__,
        science_version=science().version,
        prompt_version=prompts.PROMPT_VERSION,
        model=getattr(engine, "model", None),
        effort=getattr(engine, "effort", None),
    )


def context_for(decision: Decision) -> str | None:
    if not decision.neural_context:
        return None
    return prompts.render_neural_context(decision.signature, decision.anatomy)


def create(
    problem: Problem,
    engine: ReasoningEngine | None,
    anatomy: list[Rating] | None = None,
    pattern: dict[str, float] | None = None,
) -> Decision:
    """A new decision: with a hand-set anatomy (no Claude), or ready for the dialogue (holding
    the person's pattern, if any) and the background analysis."""
    now = datetime.now(UTC)
    if anatomy is not None:
        rated = normalise_anatomy([r.model_copy(update={"source": "user"}) for r in anatomy], "user")
        return Decision(
            id=uuid.uuid4().hex,
            created_at=now,
            updated_at=now,
            problem=problem,
            anatomy=rated,
            signature=signature(rated),
            meta=_meta(None),
        )
    if engine is None:
        raise ValueError("the dialogue needs Claude; rate the decision by hand instead")
    from reticulate.dialogue import new_dialogue

    empty = normalise_anatomy([], "model")
    return Decision(
        id=uuid.uuid4().hex,
        created_at=now,
        updated_at=now,
        problem=problem,
        dialogue=new_dialogue(engine, pattern),
        analysis="pending",
        anatomy=empty,
        signature=signature(empty),
        meta=_meta(engine),
    )


class Analysis(BaseModel):
    frame: DecisionFrame
    anatomy: list[Rating]
    watch_outs: list[WatchOut]
    usage: Usage


async def analyse(problem: Problem, engine: ReasoningEngine) -> Analysis:
    """Claude's reading of the decision: frame, anatomy and watch-outs, in one call."""
    with track_usage() as calls:
        result = await engine.analyse(problem)
    return Analysis(
        frame=DecisionFrame(**result.model_dump(exclude={"anatomy", "watch_outs"})),
        anatomy=normalise_anatomy(result.anatomy, "model"),
        watch_outs=normalise_watch_outs(result.watch_outs),
        usage=total(calls),
    )


def with_analysis(decision: Decision, analysis: Analysis) -> Decision:
    """Apply the analysis, unless the person has re-rated the anatomy by hand meanwhile."""
    hand_rated = any(r.source == "user" and r.level > 0 for r in decision.anatomy)
    anatomy = decision.anatomy if hand_rated else analysis.anatomy
    return decision.model_copy(
        update={
            "frame": analysis.frame,
            "anatomy": anatomy,
            "watch_outs": analysis.watch_outs,
            "signature": signature(anatomy),
            "analysis": "done",
            "analysis_error": None,
            "usage": decision.usage.merge(analysis.usage),
            "updated_at": datetime.now(UTC),
        }
    )


def with_analysis_failed(decision: Decision, error: str) -> Decision:
    return decision.model_copy(update={"analysis": "failed", "analysis_error": error, "updated_at": datetime.now(UTC)})


def update_anatomy(decision: Decision, anatomy: list[Rating]) -> Decision:
    """Re-rate the anatomy. Panel and tipping runs that saw the old neural context are dropped."""
    anatomy = normalise_anatomy(anatomy, "user")
    stale = decision.panel and decision.panel.meta.neural_context
    return decision.model_copy(
        update={
            "anatomy": anatomy,
            "signature": signature(anatomy),
            "panel": None if stale else decision.panel,
            "tipping": [t for t in decision.tipping if not t.meta.neural_context],
            "updated_at": datetime.now(UTC),
        }
    )


def panel_calls(decision: Decision, profiles: int, replicates: int) -> int:
    """Engine calls a panel makes: perspectives, the frame if missing, the synthesis."""
    return profiles * replicates + (0 if decision.frame else 1) + (1 if profiles > 1 else 0)


def tipping_calls(decision: Decision, keys: int, values: int, replicates: int) -> int:
    frame = decision.frame or (decision.panel.frame if decision.panel else None)
    return keys * values * replicates + (0 if frame else 1)


async def run_panel(
    decision: Decision,
    profiles: list[CognitiveProfile],
    engine: ReasoningEngine,
    *,
    replicates: int,
    neural_context: bool = True,
) -> SimulationResult:
    briefed = decision.model_copy(update={"neural_context": neural_context})
    return await simulate(
        decision.problem,
        profiles,
        engine,
        replicates=replicates,
        frame=decision.frame,
        context=context_for(briefed),
    )


def with_panel(decision: Decision, result: SimulationResult) -> Decision:
    """Apply a panel's result; earlier tipping runs belonged to the old panel and are dropped.
    The panel's result also goes into the dialogue, as a perspective to question."""
    from reticulate.dialogue import queue_note
    from reticulate.dialogue.prompts import panel_note

    updated = decision.model_copy(
        update={
            "neural_context": result.meta.neural_context,
            "frame": decision.frame or result.frame,
            "panel": result,
            "tipping": [],
            "usage": decision.usage.merge(result.meta.usage),
            "updated_at": datetime.now(UTC),
        }
    )
    return queue_note(updated, panel_note(updated))


async def run_tipping(
    decision: Decision,
    profile: CognitiveProfile,
    keys: list[str],
    values: list[float],
    engine: ReasoningEngine,
    *,
    replicates: int,
) -> list[SensitivityResult]:
    """Dose–response runs, one per dimension or trait, on the same frame and context."""
    if not 1 <= len(keys) <= MAX_TIPPING_DIMENSIONS:
        raise ValueError(f"choose 1–{MAX_TIPPING_DIMENSIONS} dimensions or traits")
    frame = decision.frame or (decision.panel.frame if decision.panel else None)
    results = []
    for key in keys:
        result = await sensitivity(
            decision.problem, profile, key, values, engine, replicates=replicates, frame=frame, context=context_for(decision)
        )
        frame = frame or result.frame
        results.append(result)
    return results


def with_tipping(decision: Decision, profile: CognitiveProfile, results: list[SensitivityResult]) -> Decision:
    keys = {r.dimension for r in results}
    kept = [t for t in decision.tipping if not (t.profile.id == profile.id and t.dimension in keys)]
    usage = decision.usage
    for result in results:
        usage = usage.merge(result.meta.usage)
    frame = decision.frame or (decision.panel.frame if decision.panel else None) or (results[0].frame if results else None)
    return decision.model_copy(
        update={"frame": frame, "tipping": kept + results, "usage": usage, "updated_at": datetime.now(UTC)}
    )

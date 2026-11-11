"""Deterministic stand-in for the reasoning engine. Test use only."""

from itertools import count

from reticulate.dialogue.schemas import Assumption, Conclusion, Notes, QualityCheck, SocraticTurn
from reticulate.profile import CognitiveProfile
from reticulate.simulation.schemas import (
    DecisionAnalysis,
    DecisionFrame,
    DimensionDriver,
    Divergence,
    Factor,
    FactorAssessment,
    FeatureRating,
    Perspective,
    Problem,
    Synthesis,
    WatchOut,
)

GO, STAY = "Go ahead", "Keep the status quo"
ANATOMY = {"possible_loss": 3, "upside": 2, "delayed_outcomes": 2, "default_option": 1}
FACTORS = [
    ("downside_risk", "Downside risk", STAY, "risk_tolerance", -1),
    ("upside_potential", "Upside potential", GO, "risk_tolerance", 1),
    ("long_term_position", "Long-term positioning", GO, "time_horizon", 1),
    ("effect_on_others", "Effect on other people", GO, "social_orientation", 1),
]


# The guide's path through a dialogue: (stage, move, mechanism) per turn.
PATH = [
    ("frame", "clarify", "none"),
    ("goals", "goal", "none"),
    ("options", "alternative", "status_quo_bias"),
    ("evidence", "evidence", "none"),
    ("tradeoffs", "opposite", "loss_aversion"),
    ("commitment", "commitment", "none"),
]


class FakeEngine:
    name, model, effort, dialogue_effort = "fake", None, None, None

    def __init__(self, jitter: bool = False):
        self.jitter = jitter
        self.calls = count()
        self.seen: list[list[str]] = []  # the answers the guide saw, per turn

    async def ask(self, problem: Problem, exchanges) -> SocraticTurn:
        answers = ["(skipped)" if e.skipped else (e.answer or "") for e in exchanges]
        self.seen.append(answers + [e.context for e in exchanges if e.context])
        stage, move, mechanism = PATH[min(len(exchanges), len(PATH) - 1)]
        notes = Notes(
            decision=problem.question,
            goals=[a for a in answers[1:2]],
            options=[GO, STAY],
            facts=[],
            unknowns=["test unknown"],
            assumptions=[Assumption(text="test assumption", status="open")],
            leaning=GO if len(exchanges) >= 3 else "",
            confidence=7 if len(exchanges) >= 5 else -1,
        )
        return SocraticTurn(
            reflection=f"You said: {answers[-1]}" if answers else "",
            question=f"Question {len(exchanges) + 1} about {stage}?",
            move=move,
            stage=stage,
            mechanism_id=mechanism if mechanism != "none" else "telepathy" if len(exchanges) == 1 else "none",
            why="test",
            scale=stage == "commitment",
            notes=notes,
            ready=len(exchanges) >= 4,
        )

    async def conclude(self, problem: Problem, exchanges) -> Conclusion:
        answered = [e.answer for e in exchanges if e.answer]
        return Conclusion(
            decided=bool(answered),
            choice=GO,
            statement=f"I will go ahead, because {answered[-1] if answered else 'of nothing yet'}.",
            reasons=answered[:2],
            tradeoffs=["test trade-off"],
            revisit_if=["test signal"],
            open_questions=["Ask the bank", "Check the lease"],
            first_step="Call the bank",
            if_then="If it is Monday, then I will call the bank.",
            review="in three months",
            # out of order and incomplete on purpose: the workflow orders them
            quality=[QualityCheck(stage="options", level="partial", note="test"), QualityCheck(stage="frame", level="strong", note="test")],
        )

    async def frame(self, problem: Problem) -> DecisionFrame:
        return DecisionFrame(decision=problem.question, options=[GO, STAY], facts=[], unknowns=[],
                             factors=[Factor(id=f, name=n, description=n) for f, n, *_ in FACTORS])

    async def analyse(self, problem: Problem) -> DecisionAnalysis:
        frame = await self.frame(problem)
        anatomy = [FeatureRating(feature_id=f, level=level, reason="test") for f, level in ANATOMY.items()]
        watch_outs = [WatchOut(mechanism_id=m, here="test", check="test") for m in ("loss_aversion", "present_bias", "unknown")]
        return DecisionAnalysis(**frame.model_dump(), anatomy=anatomy, watch_outs=watch_outs)

    async def perspective(self, problem, frame, profile: CognitiveProfile, context=None) -> Perspective:
        noise = (next(self.calls) % 3 - 1) if self.jitter else 0  # -1, 0, +1 across replicates
        assessments = []
        for fid, _, direction, dim, sign in FACTORS:
            value = profile.value(dim) if sign > 0 else 10 - profile.value(dim)
            assessments.append(FactorAssessment(factor_id=fid, weight=max(0, min(10, round(value) + noise)),
                                                favours=direction, rationale="test"))
        weight = {a.factor_id: a.weight for a in assessments}
        pull = weight["upside_potential"] - weight["downside_risk"]  # decides on risk alone
        return Perspective(recommendation=GO if pull > 0 else STAY, conditions=[], summary="", reasoning="",
                           assessments=assessments, added_factors=[], key_questions=[], would_change_mind=[],
                           confidence=5, dimension_drivers=[DimensionDriver(dimension_id="risk_tolerance", effect="")])

    async def synthesize(self, problem, frame, profiles, perspectives, space, context=None) -> Synthesis:
        return Synthesis(overview="test", divergences=[Divergence(factor_id=f.factor_id, explanation="")
                                                       for f in space.factors if f.contested],
                         shared_ground=[], blind_spots=[])

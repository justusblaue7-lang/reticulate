"""Data shapes of a decision simulation.

DecisionFrame, Perspective and Synthesis are produced by the reasoning engine (and
double as its structured-output schemas, so they carry no numeric constraints; values
are clamped after parsing). Everything below "computed" is deterministic arithmetic
over the engine's outputs.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from reticulate.profile import CognitiveProfile

SIMULATION_NOTICE = (
    "Simulated cognitive perspectives. Each answer shows how a decision-maker with the given "
    "tendencies might reason; none is a prediction of what a real person would decide, and none "
    "is financial, legal or medical advice."
)


class Problem(BaseModel):
    question: str = Field(min_length=10, max_length=8000)
    context: str = Field(default="", max_length=20000)
    options: list[str] = Field(default=[], max_length=6, description="Options named by the user; the frame keeps them")


# --- produced by the reasoning engine -------------------------------------------------


class Factor(BaseModel):
    id: str = Field(description="snake_case identifier, unique within the frame")
    name: str = Field(description="Short neutral name, e.g. 'Concentration risk'")
    description: str = Field(description="One sentence on what this consideration covers in this decision")


class DecisionFrame(BaseModel):
    """Profile-neutral structure of the decision, shared by every perspective."""

    decision: str = Field(description="One-sentence neutral restatement of the decision")
    options: list[str] = Field(description="2–4 realistic options, including keeping the status quo")
    facts: list[str] = Field(description="Facts stated in the problem, without interpretation")
    unknowns: list[str] = Field(description="Missing information that could materially change the decision")
    factors: list[Factor] = Field(description="6–10 considerations any thoughtful decision-maker might weigh")


class FeatureRating(BaseModel):
    feature_id: str = Field(description="id of a decision feature from the list")
    level: int = Field(description="0 absent, 1 minor, 2 present, 3 central")
    reason: str = Field(description="One short sentence that points to the decision's own details")


class WatchOut(BaseModel):
    mechanism_id: str = Field(description="id of a mechanism from the list")
    here: str = Field(description="One sentence on how the mechanism could pull on this particular decision")
    check: str = Field(description="The mechanism's countermove as one concrete question or step for this decision")


class DecisionAnalysis(DecisionFrame):
    """The neutral frame of a decision together with its anatomy."""

    anatomy: list[FeatureRating] = Field(description="Exactly one rating per decision feature")
    watch_outs: list[WatchOut] = Field(description="One per mechanism linked to a feature rated 2 or 3")


class FactorAssessment(BaseModel):
    factor_id: str = Field(description="id of a factor from the decision frame")
    weight: int = Field(description="Importance for this profile, 0 (ignored) to 10 (decisive)")
    favours: str = Field(description="Option this factor pushes toward, copied exactly from the frame, or 'none'")
    rationale: str = Field(description="One or two sentences, in the profile's voice")


class DimensionDriver(BaseModel):
    dimension_id: str
    effect: str = Field(description="How this tendency shaped the conclusion")


class Perspective(BaseModel):
    recommendation: str = Field(description="The option this profile would choose, copied exactly from the frame")
    conditions: list[str] = Field(description="Conditions or modifications attached to the recommendation")
    summary: str = Field(description="One or two sentences, in the profile's voice")
    reasoning: str = Field(description="150–300 words of reasoning, in the profile's voice")
    assessments: list[FactorAssessment] = Field(description="Exactly one assessment per frame factor")
    added_factors: list[Factor] = Field(description="Considerations this profile would add; may be empty")
    key_questions: list[str] = Field(description="Questions this profile needs answered before committing")
    would_change_mind: list[str] = Field(description="Evidence or events that would reverse the recommendation")
    confidence: int = Field(description="Confidence in the recommendation, 0–10")
    dimension_drivers: list[DimensionDriver] = Field(description="The 2–4 dimensions that most shaped the outcome")


class Divergence(BaseModel):
    factor_id: str
    explanation: str = Field(description="Why the perspectives weigh this factor differently")


class Synthesis(BaseModel):
    overview: str = Field(description="What the perspective space shows, in 80–150 words; no verdict")
    divergences: list[Divergence]
    shared_ground: list[str] = Field(description="Points every perspective agrees on")
    blind_spots: list[str] = Field(description="Considerations no perspective weighted highly but probably matters")


# --- computed --------------------------------------------------------------------------


class WeightSummary(BaseModel):
    mean: float
    min: int
    max: int
    n: int


class Tally(BaseModel):
    """Recommendations across replicate runs."""

    option: str  # most frequent
    counts: dict[str, int]


class FactorSpread(BaseModel):
    factor_id: str
    name: str
    weights: dict[str, WeightSummary]  # profile id -> weight across replicates
    favours: dict[str, str]  # profile id -> most frequent direction
    spread: float  # range of the profile means
    contested: bool


class PerspectiveSpace(BaseModel):
    profile_ids: list[str]
    factors: list[FactorSpread]  # most contested first
    recommendations: dict[str, Tally]
    agreement: float  # share of profiles whose most frequent option is the overall most frequent
    notes: list[str]


class DosePoint(BaseModel):
    value: float
    mean: float
    min: int
    max: int
    n: int


class DoseResponse(BaseModel):
    """How one factor's weight changes as a single dimension is varied."""

    factor_id: str
    name: str
    points: list[DosePoint]
    slope: float  # least-squares change in weight per scale point, over all observations
    slope_se: float | None  # standard error of the slope; None when it cannot be estimated


class Usage(BaseModel):
    """Tokens billed for a run, and their list price where the model's price is known."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = None

    def merge(self, other: "Usage | None") -> "Usage":
        if other is None:
            return self
        fields = ("calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
        merged = {f: getattr(self, f) + getattr(other, f) for f in fields}
        costs = [c for c in (self.cost_usd, other.cost_usd) if c is not None]
        return Usage(**merged, cost_usd=round(sum(costs), 4) if costs else None)


class RunMeta(BaseModel):
    """Everything needed to reproduce or audit a run."""

    app_version: str
    science_version: str
    prompt_version: str
    engine: str
    model: str | None
    effort: str | None
    replicates: int
    neural_context: bool = False  # whether perspectives saw the decision's neural context
    usage: Usage | None = None


class SimulationResult(BaseModel):
    id: str
    kind: Literal["simulation"] = "simulation"
    created_at: datetime
    meta: RunMeta
    problem: Problem
    frame: DecisionFrame
    profiles: list[CognitiveProfile]
    perspectives: dict[str, list[Perspective]]  # profile id -> one perspective per replicate
    space: PerspectiveSpace
    synthesis: Synthesis | None
    notice: str = SIMULATION_NOTICE


class SensitivityResult(BaseModel):
    id: str
    kind: Literal["sensitivity"] = "sensitivity"
    created_at: datetime
    meta: RunMeta
    problem: Problem
    frame: DecisionFrame
    profile: CognitiveProfile  # the base profile; only `dimension` varies
    dimension: str
    values: list[float]
    perspectives: dict[str, list[Perspective]]  # value (as text) -> one perspective per replicate
    curves: list[DoseResponse]  # steepest first
    recommendations: dict[str, Tally]  # value (as text) -> tally
    notice: str = SIMULATION_NOTICE

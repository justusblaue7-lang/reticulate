"""Data shapes of the decision mode."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from reticulate.dialogue.schemas import Dialogue
from reticulate.simulation.schemas import (
    SIMULATION_NOTICE,
    DecisionFrame,
    Problem,
    SensitivityResult,
    SimulationResult,
    Usage,
    WatchOut,
)


class Rating(BaseModel):
    """How strongly a decision has one feature of the decision anatomy."""

    feature_id: str
    level: int = Field(ge=0, le=3)  # 0 absent, 1 minor, 2 present, 3 central
    reason: str = ""
    source: Literal["model", "user"] = "model"


class StructureValue(BaseModel):
    key: str
    z: float


class TermValue(BaseModel):
    term: str
    r: float


class SignatureSource(BaseModel):
    """The signature in one literature source."""

    maps: int  # feature maps that entered it
    display_max: float
    coverage: float
    top_regions: list[StructureValue]
    networks: dict[str, float]  # Yeo network -> share of the suprathreshold cortex
    constructs: dict[str, float]  # dimension -> spatial r with its construct map
    decoding: list[TermValue]  # functional terms whose maps resemble the signature


class SourceAgreement(BaseModel):
    r: float
    dice: float | None
    maps: int  # feature maps both sources have


class DimensionRelevance(BaseModel):
    dimension_id: str
    weight: float  # authored link: level-weighted share of the anatomy that engages it, 0–1
    features: list[str]
    overlap: dict[str, float]  # source -> spatial r of the signature with the construct map


class EngagedMechanism(BaseModel):
    mechanism_id: str
    level: int  # highest level among the features that engage it
    features: list[str]


class NeuralSignature(BaseModel):
    weights: dict[str, float]  # feature id -> level / 3, for features with a map
    neuroquery: SignatureSource | None
    neurosynth: SignatureSource | None
    agreement: SourceAgreement | None
    dimensions: list[DimensionRelevance]  # most engaged first
    mechanisms: list[EngagedMechanism]  # most engaged first
    findings: list[int]  # indexes into the science layer's region–dimension findings
    unmapped: list[str]  # rated features without a meta-analytic map
    available: bool = True  # False when the literature sources are not installed


class DecisionMeta(BaseModel):
    app_version: str
    science_version: str
    prompt_version: str
    model: str | None
    effort: str | None


class Decision(BaseModel):
    """A decision worked through in Reticulate: the record behind its folder in data/decisions."""

    id: str
    kind: Literal["decision"] = "decision"
    created_at: datetime
    updated_at: datetime
    problem: Problem
    dialogue: Dialogue | None = None  # the Socratic dialogue; None for decisions rated without one
    analysis: Literal["none", "pending", "done", "failed"] = "none"  # Claude's reading of the decision
    analysis_error: str | None = None
    settled: list[str] = []  # open questions the person has ticked off
    frame: DecisionFrame | None = None  # None until Claude has analysed the decision
    anatomy: list[Rating]
    watch_outs: list[WatchOut] = []  # how engaged mechanisms could pull on this decision (Claude)
    signature: NeuralSignature
    neural_context: bool = True  # whether the panel saw the neural context
    panel: SimulationResult | None = None
    tipping: list[SensitivityResult] = []
    usage: Usage = Usage()
    meta: DecisionMeta
    notice: str = SIMULATION_NOTICE
    trial_grant: str | None = None  # reticulate.space: a free decision on the house key (see reticulate.trial)

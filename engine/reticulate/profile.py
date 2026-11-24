"""Cognitive profiles: the computational representation of a person or archetype.

A profile has three layers that enter a simulation (the eight decision dimensions, the Big
Five personality traits with up to three basic values, and the situation) and one that
never does: the person it is shown as, a fictional name and a 3D look. Name and appearance
are kept out of the prompts so that a simulated decision cannot lean on stereotypes about
how people are called or how they look; the simulation sees the role (`name`) only.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from reticulate.provenance import Provenance
from reticulate.science import science


class Score(BaseModel):
    """A 0–10 leaning on one dimension or trait, with its origin."""

    value: float = Field(ge=0, le=10)
    provenance: Provenance = Provenance.AUTHORED
    uncertainty: float | None = Field(default=None, ge=0, description="1 SD on the 0–10 scale")
    source: str | None = Field(default=None, description="Instrument, model or person behind the value")


def _coerce_scores(value: object) -> object:
    # Library files write `risk_tolerance: 2` as shorthand for an authored score.
    if isinstance(value, dict):
        return {k: {"value": v} if isinstance(v, int | float) else v for k, v in value.items()}
    return value


# Profiles saved before science 1.0 rated eight hypothetical tendencies. Where one of them asked
# about the same attitude as a survey question, its value carries over; the rest start at the
# middle of the scale. Both are marked, so the person can see and change them.
LEGACY_DIMENSIONS = {"risk_tolerance": "risk_taking", "time_horizon": "patience", "social_orientation": "altruism"}
NEW_DIMENSIONS = ("risk_taking", "patience", "altruism", "trust", "positive_reciprocity", "negative_reciprocity")


def migrate_dimensions(value: object) -> object:
    """Dimensions of a profile saved before 1.0, as the six attitudes of 1.0; others unchanged."""
    if not isinstance(value, dict) or not set(value) & {"exploration", "analytical_style", "risk_tolerance"}:
        return value
    out: dict = {}
    for old, new in LEGACY_DIMENSIONS.items():
        if old in value:
            score = value[old] if isinstance(value[old], dict) else {"value": value[old]}
            out[new] = {**score, "source": f"carried over from '{old}' (before 1.0)"}
    for new in NEW_DIMENSIONS:
        out.setdefault(new, {"value": 5, "source": "not set before 1.0; the middle of the scale"})
    return out


class ProfileKind(StrEnum):
    PERSONA = "persona"  # authored vignette of a kind of decision-maker (avatar library)
    ARCHETYPE = "archetype"  # abstract thinking-style archetype
    FIGURE_INSPIRED = "figure_inspired"  # informed by public material about a real person
    PERSONAL = "personal"  # a user's own cognitive twin
    CUSTOM = "custom"  # ad-hoc or counterfactual profile


class Source(BaseModel):
    title: str
    kind: str = Field(description="writing, speech, interview, biography, record ...")
    url: str | None = None


class PersonalContext(BaseModel):
    """Situation of the decision-maker: what they want and what binds them."""

    goals: list[str] = []
    constraints: list[str] = []
    notes: str = ""


class Personality(BaseModel):
    """Big Five traits (0–10, 5 = population average) and up to three Schwartz values."""

    traits: dict[str, Score]
    values: list[str] = Field(default=[], max_length=3)

    @field_validator("traits", mode="before")
    @classmethod
    def _coerce_numbers(cls, value: object) -> object:
        return _coerce_scores(value)

    @model_validator(mode="after")
    def _check(self) -> "Personality":
        expected = set(science().personality.trait_ids)
        if set(self.traits) != expected:
            raise ValueError(f"personality traits must be exactly {sorted(expected)}")
        known = {v.id for v in science().personality.values}
        unknown = [v for v in self.values if v not in known]
        if unknown or len(set(self.values)) != len(self.values):
            raise ValueError(f"values must be distinct Schwartz values, unknown: {unknown}")
        return self


Hair = Literal["bald", "buzz", "short", "swept", "wavy", "long", "curly", "coily", "locs", "braids", "bun", "headscarf"]
HairColor = Literal["black", "dark_brown", "brown", "auburn", "blond", "grey", "white"]


class Person(BaseModel):
    """Who the avatar is shown as. Never part of a prompt."""

    name: str = Field(default="", max_length=80, description="A fictional person's name, shown in the interface")
    look: str = Field(default="", pattern=r"^[a-z0-9_]*$", description="id of a 3D person in web/public/people")


class Phenotype(BaseModel):
    """The drawn cameo of builds before 0.5. Read from older avatar files; no longer drawn."""

    age: int = Field(default=40, ge=18, le=90)
    skin: int = Field(default=2, ge=0, le=7, description="tone, light (0) to deep (7)")
    face: float = Field(default=0.5, ge=0, le=1, description="brow, jaw and chin: fine (0) to strong (1)")
    nose: Literal["straight", "aquiline", "concave", "broad"] = "straight"
    lips: float = Field(default=0.5, ge=0, le=1, description="thin (0) to full (1)")
    build: float = Field(default=0.5, ge=0, le=1, description="slight (0) to heavy (1)")
    hair: Hair = "short"
    hair_color: HairColor = "dark_brown"
    facial_hair: Literal["none", "stubble", "moustache", "beard", "full_beard"] = "none"
    glasses: Literal["none", "round", "rectangular"] = "none"
    attire: Literal["crew", "collar", "blazer", "turtleneck", "knit"] = "crew"


class CognitiveProfile(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_~=.\-]+$")
    name: str
    kind: ProfileKind = ProfileKind.CUSTOM
    origin: Literal["library", "user"] = Field(default="library", description="shipped persona or the user's own")
    summary: str = ""
    nuance: str = Field(default="", description="Where this person departs from the stereotype of their role")
    priorities: list[str] = []
    voice: str = ""
    dimensions: dict[str, Score]
    personality: Personality | None = None
    context: PersonalContext | None = None
    person: Person | None = None
    phenotype: Phenotype | None = None  # superseded by `person`
    sources: list[Source] = []

    @field_validator("dimensions", mode="before")
    @classmethod
    def _coerce_numbers(cls, value: object) -> object:
        return _coerce_scores(migrate_dimensions(value))

    @model_validator(mode="after")
    def _check(self) -> "CognitiveProfile":
        expected = set(science().dimension_ids)
        given = set(self.dimensions)
        if given != expected:
            missing, unknown = sorted(expected - given), sorted(given - expected)
            raise ValueError(f"profile '{self.id}' dimensions: missing {missing}, unknown {unknown}")
        if self.kind == ProfileKind.FIGURE_INSPIRED and not self.sources:
            raise ValueError("figure-inspired profiles must list the public sources they are built from")
        return self

    def value(self, key: str) -> float:
        """Score of a dimension or, when it has a personality, a trait."""
        if key in self.dimensions:
            return self.dimensions[key].value
        if self.personality and key in self.personality.traits:
            return self.personality.traits[key].value
        raise KeyError(key)

    def vector(self) -> list[float]:
        return [self.value(d) for d in science().dimension_ids]

    def with_value(self, key: str, value: float) -> "CognitiveProfile":
        """Counterfactual copy with one dimension or trait changed."""
        score = Score(value=value, provenance=Provenance.AUTHORED, source="counterfactual")
        update: dict = {
            "id": f"{self.id}~{key}={value:g}",
            "kind": ProfileKind.CUSTOM,
        }
        if key in self.dimensions:
            update["name"] = f"{self.name} ({science().dimension(key).name} {value:g})"
            update["dimensions"] = {**self.dimensions, key: score}
        elif self.personality and key in self.personality.traits:
            trait = next(t for t in science().personality.traits if t.id == key)
            update["name"] = f"{self.name} ({trait.name} {value:g})"
            update["personality"] = self.personality.model_copy(update={"traits": {**self.personality.traits, key: score}})
        else:
            raise KeyError(key)
        return self.model_copy(update=update)

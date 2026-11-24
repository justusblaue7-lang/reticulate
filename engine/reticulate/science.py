"""The science layer: attitudes, personality, brain structures and networks (for the atlas),
stimuli, decision features, biases, the dialogue and references.

The content lives in YAML files under reticulate/data so that it can be reviewed and
versioned as science, separately from code. This module loads it into typed models and
checks that every cross-reference resolves.
"""

from functools import cache
from importlib.resources import files
from typing import Literal

import yaml
from pydantic import BaseModel, model_validator


class Instrument(BaseModel):
    id: str
    name: str
    kind: Literal["questionnaire", "behavioural_task", "neural"]
    ref: str | None = None


class PoleAnchors(BaseModel):
    low: str
    high: str


class ConstructMap(BaseModel):
    query: str  # NeuroQuery query for the dimension's construct
    neurosynth: list[str] = []  # Neurosynth terms; a study counts when its abstract uses any
    quality: Literal["good", "moderate", "low"]
    note: str


class Dimension(BaseModel):
    id: str
    name: str
    low_pole: str
    high_pole: str
    definition: str
    constructs: list[str]
    instruments: list[Instrument]
    notes: str = ""
    refs: list[str] = []
    construct_map: ConstructMap | None = None  # a meta-analytic map in the atlas, if one fits
    reasoning: PoleAnchors


class Network(BaseModel):
    id: str
    index: int  # value in the Yeo2011_7Networks annotation
    name: str
    functions: list[str]
    notes: str = ""
    refs: list[str]


class RegionGroup(BaseModel):
    id: str
    name: str


class Region(BaseModel):
    id: str
    name: str
    alias: str = ""
    group: str
    kind: Literal["cortex", "medialwall", "deep"]
    atlas_labels: list[str | int]
    functions: list[str]
    refs: list[str]


# replication: a multi-site or multi-country replication; field: field data or a field trial.
Design = Literal[
    "within_subject", "individual_differences", "lesion", "stimulation", "meta_analysis", "theory", "replication", "field"
]


class RegionLink(BaseModel):
    region: str
    dimension: str
    design: Design
    finding: str
    refs: list[str]


class StimulusCategory(BaseModel):
    id: str
    name: str


class Stimulus(BaseModel):
    id: str
    category: str
    name: str
    paradigm: str
    query: str
    neurosynth: list[str] = []
    note: str = ""
    refs: list[str]


class Trait(BaseModel):
    id: str
    name: str
    low_pole: str
    high_pole: str
    definition: str
    anchors: PoleAnchors


class Value(BaseModel):
    id: str
    name: str
    definition: str


class Personality(BaseModel):
    traits: list[Trait]
    values: list[Value]
    refs: list[str]
    value_refs: list[str]

    @property
    def trait_ids(self) -> list[str]:
        return [t.id for t in self.traits]


class Evidence(BaseModel):
    design: Design
    finding: str
    refs: list[str]


class Countermove(BaseModel):
    """A remedy for a bias, listed only when a meta-analysis or field trials show that it works."""

    text: str
    finding: str  # what the trials showed
    refs: list[str]


class Mechanism(BaseModel):
    id: str
    name: str
    summary: str
    evidence: list[Evidence]
    dimensions: list[str]
    refs: list[str]
    countermove: Countermove | None = None  # none unless a remedy meets the bar


class DecisionFeature(BaseModel):
    id: str
    name: str
    question: str  # rated by Claude
    ask: str  # the same question put to the user in the self-check
    neuroquery: str  # empty: no meta-analytic map
    neurosynth: list[str]
    dimensions: list[str]
    mechanisms: list[str]
    note: str = ""


class SocraticStage(BaseModel):
    """One part of the decision aid; the dialogue moves through them in order."""

    id: str
    name: str
    aim: str
    note: str = ""
    refs: list[str]


class SocraticMove(BaseModel):
    """A kind of question the dialogue can ask; `finding` only where the evidence bar holds."""

    id: str
    name: str
    question: str  # the move's typical form
    finding: str = ""
    refs: list[str] = []

    @model_validator(mode="after")
    def _finding_needs_refs(self) -> "SocraticMove":
        if self.finding and not self.refs:
            raise ValueError("a move's finding needs its references")
        return self


class SocraticMethod(BaseModel):
    summary: str
    refs: list[str]


class Socratic(BaseModel):
    method: SocraticMethod
    stages: list[SocraticStage]
    moves: list[SocraticMove]


class PatternItem(BaseModel):
    """One survey question, answered from 0 (`low`) to 10 (`high`)."""

    id: str
    dimension: str
    text: str
    low: str
    high: str


class Leaning(BaseModel):
    """What an answer toward one end has been found to go with, and the bias it was validated against."""

    watch: str
    mechanisms: list[str] = []


class DimensionLeanings(BaseModel):
    dimension: str
    low: Leaning
    high: Leaning


class PatternMethod(BaseModel):
    summary: str
    refs: list[str]


class PatternScience(BaseModel):
    """The survey questions behind a person's own pattern, and what their answers go with."""

    method: PatternMethod
    items: list[PatternItem]
    leanings: list[DimensionLeanings]

    def leaning(self, dimension_id: str, pole: Literal["low", "high"]) -> Leaning:
        for entry in self.leanings:
            if entry.dimension == dimension_id:
                return entry.low if pole == "low" else entry.high
        raise KeyError(dimension_id)


class Science(BaseModel):
    version: str
    dimensions: list[Dimension]
    personality: Personality
    networks: list[Network]
    region_groups: list[RegionGroup]
    regions: list[Region]
    links: list[RegionLink] = []  # brain-region findings per attitude: none since 1.0
    stimulus_categories: list[StimulusCategory]
    stimuli: list[Stimulus]
    features: list[DecisionFeature]
    mechanisms: list[Mechanism]
    socratic: Socratic
    pattern: PatternScience
    references: dict[str, str]

    @model_validator(mode="after")
    def _check_references(self) -> "Science":
        refs = set(self.references)
        dims = {d.id for d in self.dimensions}
        regions = {r.id for r in self.regions}
        problems: list[str] = []

        def need(kind: str, key: str, known: set[str]) -> None:
            if key not in known:
                problems.append(f"unknown {kind} '{key}'")

        for d in self.dimensions:
            for ref in d.refs + [i.ref for i in d.instruments if i.ref]:
                need("reference", ref, refs)
        for item in [*self.networks, *self.regions, *self.links, *self.stimuli, *self.mechanisms]:
            for ref in item.refs:
                need("reference", ref, refs)
        for ref in self.personality.refs + self.personality.value_refs:
            need("reference", ref, refs)
        mechanisms = {m.id for m in self.mechanisms}
        for m in self.mechanisms:
            for e in m.evidence:
                for ref in e.refs:
                    need("reference", ref, refs)
            for ref in m.countermove.refs if m.countermove else []:
                need("reference", ref, refs)
            for dim in m.dimensions:
                need("dimension", dim, dims)
        for f in self.features:
            for dim in f.dimensions:
                need("dimension", dim, dims)
            for mech in f.mechanisms:
                need("mechanism", mech, mechanisms)
        for item in [self.socratic.method, *self.socratic.stages, *self.socratic.moves]:
            for ref in item.refs:
                need("reference", ref, refs)
        for item in self.pattern.items:
            need("dimension", item.dimension, dims)
        for ref in self.pattern.method.refs:
            need("reference", ref, refs)
        for entry in self.pattern.leanings:
            need("dimension", entry.dimension, dims)
            for mech in entry.low.mechanisms + entry.high.mechanisms:
                need("mechanism", mech, mechanisms)
        for dim in dims:
            if sum(i.dimension == dim for i in self.pattern.items) != 1:
                problems.append(f"the pattern needs exactly one question for '{dim}'")
            if sum(e.dimension == dim for e in self.pattern.leanings) != 1:
                problems.append(f"pattern leanings for '{dim}' need exactly one entry")
        for r in self.regions:
            need("region group", r.group, {g.id for g in self.region_groups})
        for link in self.links:
            need("region", link.region, regions)
            need("dimension", link.dimension, dims)
        for s in self.stimuli:
            need("stimulus category", s.category, {c.id for c in self.stimulus_categories})
        for collection, label in (
            (self.regions, "region"),
            (self.stimuli, "stimulus"),
            (self.dimensions, "dimension"),
            (self.features, "decision feature"),
            (self.mechanisms, "mechanism"),
            (self.personality.traits, "trait"),
            (self.socratic.stages, "dialogue stage"),
            (self.socratic.moves, "dialogue move"),
            (self.pattern.items, "pattern item"),
        ):
            ids = [x.id for x in collection]
            for dup in {i for i in ids if ids.count(i) > 1}:
                problems.append(f"duplicate {label} id '{dup}'")
        if problems:
            raise ValueError("science data is inconsistent: " + "; ".join(sorted(set(problems))))
        return self

    @property
    def dimension_ids(self) -> list[str]:
        return [d.id for d in self.dimensions]

    def dimension(self, dimension_id: str) -> Dimension:
        for d in self.dimensions:
            if d.id == dimension_id:
                return d
        raise KeyError(dimension_id)

    def region(self, region_id: str) -> Region:
        for r in self.regions:
            if r.id == region_id:
                return r
        raise KeyError(region_id)

    def feature(self, feature_id: str) -> DecisionFeature:
        for f in self.features:
            if f.id == feature_id:
                return f
        raise KeyError(feature_id)

    def mechanism(self, mechanism_id: str) -> Mechanism:
        for m in self.mechanisms:
            if m.id == mechanism_id:
                return m
        raise KeyError(mechanism_id)

    def move(self, move_id: str) -> SocraticMove:
        for m in self.socratic.moves:
            if m.id == move_id:
                return m
        raise KeyError(move_id)


def _read(name: str) -> dict:
    return yaml.safe_load(files("reticulate.data").joinpath(name).read_text(encoding="utf-8"))


@cache
def science() -> Science:
    regions = _read("regions.yaml")
    stimuli = _read("stimuli.yaml")
    personality = _read("personality.yaml")
    socratic = _read("socratic.yaml")
    pattern = _read("pattern.yaml")
    return Science(
        version="1.0.0",
        dimensions=_read("dimensions.yaml")["dimensions"],
        personality={k: personality[k] for k in ("traits", "values", "refs", "value_refs")},
        networks=_read("networks.yaml")["networks"],
        region_groups=regions["groups"],
        regions=regions["regions"],
        stimulus_categories=stimuli["categories"],
        stimuli=stimuli["stimuli"],
        features=_read("decision_features.yaml")["features"],
        mechanisms=_read("mechanisms.yaml")["mechanisms"],
        socratic={k: socratic[k] for k in ("method", "stages", "moves")},
        pattern={k: pattern[k] for k in ("method", "items", "leanings")},
        references=_read("references.yaml"),
    )

"""The person's own pattern: a self-rating on the eight dimensions, and its leanings.

The pattern is how the person describes their decision-making in general (data/pattern.yaml
holds the statements and the leanings). It is `authored`, never `measured`. It lives in one
file in the data folder, and a dialogue takes a snapshot of it when it starts, so a
dialogue always shows, and replays with, the pattern it was held with.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from reticulate.science import science

Pole = Literal["low", "high"]

# A score this far from the midpoint (5) is a leaning the dialogue attends to. Item scores
# move in steps of 1.25, so "clear" starts one full answer step from neutral on both items.
CLEAR = 2.5
SOME = 1.25


class PatternScore(BaseModel):
    value: float = Field(ge=0, le=10)
    adjusted: bool = False  # the person moved it after the self-rating


class PersonalPattern(BaseModel):
    kind: Literal["personal_pattern"] = "personal_pattern"
    provenance: Literal["authored"] = "authored"  # self-rated (docs/epistemics.md)
    answers: dict[str, int] = {}  # item id -> 1…5
    dimensions: dict[str, PatternScore]
    updated_at: datetime
    science_version: str


class PatternRequest(BaseModel):
    """Answers to the self-rating, and optional adjustments to the resulting scores."""

    answers: dict[str, int]
    adjust: dict[str, float] = {}


class Leaning(BaseModel):
    dimension: str
    pole: Pole
    strength: Literal["clear", "some"]
    value: float


def score(answers: dict[str, int]) -> dict[str, float]:
    """0–10 per dimension: the mean of the high item and the reversed low item."""
    sci = science()
    known = {i.id: i for i in sci.pattern.items}
    unknown = sorted(set(answers) - set(known))
    if unknown:
        raise ValueError(f"unknown pattern items: {', '.join(unknown)}")
    missing = sorted(set(known) - set(answers))
    if missing:
        raise ValueError(f"answer every statement; missing: {', '.join(missing)}")
    for item_id, value in answers.items():
        if value not in (1, 2, 3, 4, 5):
            raise ValueError(f"'{item_id}' needs an answer from 1 to 5")
    out: dict[str, float] = {}
    for dim in sci.dimension_ids:
        items = [i for i in sci.pattern.items if i.dimension == dim]
        points = [answers[i.id] if i.pole == "high" else 6 - answers[i.id] for i in items]
        out[dim] = round((sum(points) / len(points) - 1) * 2.5, 2)
    return out


def build(request: PatternRequest) -> PersonalPattern:
    scores = score(request.answers)
    sci = science()
    dims: dict[str, PatternScore] = {}
    for dim, value in scores.items():
        if dim in request.adjust:
            moved = max(0.0, min(10.0, float(request.adjust[dim])))
            dims[dim] = PatternScore(value=moved, adjusted=moved != value)
        else:
            dims[dim] = PatternScore(value=value)
    unknown = sorted(set(request.adjust) - set(scores))
    if unknown:
        raise ValueError(f"unknown dimensions: {', '.join(unknown)}")
    return PersonalPattern(
        answers=request.answers, dimensions=dims, updated_at=datetime.now(UTC), science_version=sci.version
    )


def leanings(values: dict[str, float]) -> list[Leaning]:
    """The pronounced leanings, strongest first; dimensions near 5 have none."""
    out = []
    for dim in science().dimension_ids:
        if dim not in values:
            continue
        v = values[dim]
        d = v - 5
        if abs(d) < SOME:
            continue
        out.append(Leaning(dimension=dim, pole="high" if d > 0 else "low", strength="clear" if abs(d) >= CLEAR else "some", value=v))
    return sorted(out, key=lambda x: -abs(x.value - 5))


def snapshot(pattern: PersonalPattern | None) -> dict[str, float] | None:
    return {k: v.value for k, v in pattern.dimensions.items()} if pattern else None


# --- the file ----------------------------------------------------------------------------


def load(path: Path) -> PersonalPattern | None:
    if not path.exists():
        return None
    return PersonalPattern.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def save(path: Path, pattern: PersonalPattern) -> PersonalPattern:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = pattern.model_dump(mode="json")
    header = "# Your pattern: how you described your own decision-making in Reticulate (self-rated).\n"
    path.write_text(header + yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return pattern


def delete(path: Path) -> bool:
    if path.exists():
        path.unlink()
        return True
    return False

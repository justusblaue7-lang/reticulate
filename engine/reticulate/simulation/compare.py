"""Deterministic analysis of simulated perspectives.

Two designs are supported:
- a *perspective space* compares different profiles on the same decision frame;
- a *dose–response* curve varies one dimension of one profile, holding everything else
  fixed, which is the only design here that attributes a change in reasoning to a
  dimension. Correlating weights with dimensions across different profiles is not
  offered: profiles differ on several dimensions at once, so such correlations are
  confounded.
"""

from collections import Counter
from statistics import mean

import numpy as np

from reticulate.simulation.schemas import (
    DecisionFrame,
    DosePoint,
    DoseResponse,
    FactorSpread,
    Perspective,
    PerspectiveSpace,
    Tally,
    WeightSummary,
)

CONTESTED_SPREAD = 4  # range of mean weights (0–10) at which a factor counts as contested
SALIENT_WEIGHT = 4  # minimum mean weight for a factor's direction to count as a disagreement


def tally(perspectives: list[Perspective]) -> Tally:
    counts = Counter(p.recommendation for p in perspectives)
    return Tally(option=counts.most_common(1)[0][0], counts=dict(counts))


def _weights(perspectives: list[Perspective], factor_id: str) -> tuple[list[int], list[str]]:
    weights, directions = [], []
    for p in perspectives:
        for a in p.assessments:
            if a.factor_id == factor_id:
                weights.append(a.weight)
                directions.append(a.favours)
                break
    return weights, directions


def compare(frame: DecisionFrame, profile_ids: list[str], perspectives: dict[str, list[Perspective]]) -> PerspectiveSpace:
    factors = []
    for factor in frame.factors:
        weights, favours = {}, {}
        for pid in profile_ids:
            ws, dirs = _weights(perspectives[pid], factor.id)
            if ws:
                weights[pid] = WeightSummary(mean=round(mean(ws), 2), min=min(ws), max=max(ws), n=len(ws))
                favours[pid] = Counter(dirs).most_common(1)[0][0]
        if not weights:
            continue
        means = [w.mean for w in weights.values()]
        directions = {favours[p] for p in weights if weights[p].mean >= SALIENT_WEIGHT and favours[p] != "none"}
        spread = round(max(means) - min(means), 2)
        factors.append(
            FactorSpread(
                factor_id=factor.id,
                name=factor.name,
                weights=weights,
                favours=favours,
                spread=spread,
                contested=spread >= CONTESTED_SPREAD or len(directions) > 1,
            )
        )
    factors.sort(key=lambda f: (-f.spread, f.factor_id))
    recommendations = {pid: tally(perspectives[pid]) for pid in profile_ids}
    modal = Counter(t.option for t in recommendations.values()).most_common(1)[0][1] if profile_ids else 0
    replicates = min((len(v) for v in perspectives.values()), default=0)
    notes = []
    if replicates < 3:
        notes.append(
            "Fewer than three replicates per profile: language-model output varies from run to run, "
            "so single differences may not be stable."
        )
    notes.append(
        "Differences between profiles show how perspectives diverge, not which dimension causes it; "
        "use a dose–response run to attribute an effect to one dimension."
    )
    return PerspectiveSpace(
        profile_ids=profile_ids,
        factors=factors,
        recommendations=recommendations,
        agreement=round(modal / len(profile_ids), 2) if profile_ids else 0.0,
        notes=notes,
    )


def dose_response(frame: DecisionFrame, values: list[float], perspectives: dict[str, list[Perspective]]) -> list[DoseResponse]:
    curves = []
    for factor in frame.factors:
        points, xs, ys = [], [], []
        for v in values:
            ws, _ = _weights(perspectives[f"{v:g}"], factor.id)
            if ws:
                points.append(DosePoint(value=v, mean=round(mean(ws), 2), min=min(ws), max=max(ws), n=len(ws)))
                xs += [v] * len(ws)
                ys += ws
        if len(set(xs)) < 2:
            continue
        x, y = np.array(xs, float), np.array(ys, float)
        slope, intercept = np.polyfit(x, y, 1)
        se = None
        if len(x) > 2:
            residual = y - (slope * x + intercept)
            sxx = ((x - x.mean()) ** 2).sum()
            se = float(np.sqrt((residual**2).sum() / (len(x) - 2) / sxx)) if sxx > 0 else None
        curves.append(
            DoseResponse(
                factor_id=factor.id,
                name=factor.name,
                points=points,
                slope=round(float(slope), 3),
                slope_se=None if se is None else round(se, 3),
            )
        )
    curves.sort(key=lambda c: -abs(c.slope))
    return curves

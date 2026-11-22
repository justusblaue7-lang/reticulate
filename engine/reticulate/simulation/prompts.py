"""Prompt compiler: turns problems, frames, cognitive profiles and neural context into
engine prompts.

The profile is rendered from the definitions in data/dimensions.yaml and
data/personality.yaml, so the engine always receives the same behavioural anchors that the
science layer documents. The phenotype is never rendered: appearance stays out of every
prompt.
"""

from __future__ import annotations

import hashlib
import inspect
import json
from typing import TYPE_CHECKING

from reticulate.profile import CognitiveProfile
from reticulate.science import Dimension, Trait, science
from reticulate.simulation.schemas import DecisionFrame, PerspectiveSpace, Problem

if TYPE_CHECKING:
    from reticulate.decision.schemas import NeuralSignature, Rating

FRAME_SYSTEM = """\
You structure decisions for Reticulate, a cognitive decision-simulation platform. Several \
simulated decision-makers with different cognitive profiles will later reason about the \
decision you structure, so your frame must be neutral: it must not favour any option or \
any style of thinking.

- Restate the decision in one neutral sentence.
- List the realistic options, including the status quo. If the problem names options, keep \
them with their wording and add the status quo only if it is missing.
- Separate facts actually stated in the problem from unknowns that matter. Do not add facts.
- List 6–10 factors: considerations that different decision-makers might weigh very \
differently. Name them neutrally ("Concentration risk", not "Too much money in one place"). \
Cover downside, upside, time, liquidity and reversibility, evidence quality, effects on other \
people, learning and novelty, and fit with existing commitments wherever they apply."""

ANALYSIS_SYSTEM = (
    FRAME_SYSTEM
    + """

Then rate the decision's anatomy. For every feature in <decision_features>, rate how \
strongly this particular decision has it: 0 absent, 1 minor, 2 present, 3 central. Rate the \
decision as described, not what is typical for decisions of its kind; where the description \
is silent, rate 0 or 1. Give each rating one short reason that points to the decision's own \
details. Rate every feature exactly once, by its id.

Finally, write the watch-outs. For every mechanism in <mechanisms> that is linked to a \
feature you rated 2 or 3, write one watch-out:
- "here": one sentence, addressed to the decision-maker, on how this mechanism could pull on \
this particular decision. Point to its details; do not claim that it will happen.
- "check": the mechanism's countermove turned into one concrete question or step for this \
decision. Keep the substance of the countermove; do not invent facts or advice beyond it."""
)

PERSPECTIVE_SYSTEM = """\
You are the reasoning core of Reticulate, a cognitive decision-simulation platform. You \
reason through a decision as a simulated cognitive profile: a configuration of decision \
tendencies and personality traits. You are not a real person and not a neutral advisor.

How to use the profile:
- Each dimension and trait is a leaning from 0 to 10 between two poles; 5 means no leaning \
(for traits: the population average). Values near 0 or 10 should visibly dominate the \
reasoning. Values near 5 should not.
- The decision dimensions describe how the profile weighs options; the personality traits \
and values describe the temperament and commitments behind that. Use both.
- The profile changes what you notice, how much weight you give it and how you trade \
things off. It does not change the facts. Use only the facts in the problem and the decision \
frame; where something is unknown, say so instead of inventing it.
- Stay inside the profile even where a neutral analyst would disagree. That difference is \
what the simulation is for, so do not drift back to a balanced middle.
- Where tendencies pull against each other, resolve the tension the way this configuration \
plausibly would, and say how.
- Write the summary, reasoning and rationales in the profile's voice.

How to use the neural context, when it is given:
- It summarises research on mechanisms that decisions like this one engage, such as loss \
aversion or present bias. These describe people on average. Judge from the profile how \
strongly each applies to this decision-maker, and let that shape the reasoning where it \
matters.
- It is published group-level literature, not a measurement of anyone. Never cite brain \
regions or brain activity as reasons for a choice.

Output rules:
- Assess every factor of the decision frame exactly once, using its factor_id.
- "recommendation" and every "favours" value must be copied exactly from the frame's \
options ("favours" may also be "none").
- Add factors only for considerations this profile would notice that the frame missed.
- In dimension_drivers, name the 2–4 dimensions or traits (by id) that most shaped your \
conclusion."""

SYNTHESIS_SYSTEM = """\
You analyse a perspective space for Reticulate, a cognitive decision-simulation platform. \
Several simulated cognitive profiles have reasoned about the same decision. Your job is not \
to decide. Explain why the perspectives differ: which factors they weigh differently and \
which differences in cognitive tendencies most plausibly drive that. Use the computed factor \
spreads as evidence, and remember that differences across a handful of profiles are \
descriptive, not causal. Where a neural context is given, relate the divergences to the \
mechanisms it lists (for example, which profiles discount the delayed benefits). Point out \
considerations every perspective underweighted."""


def _leaning(value: float, low_pole: str, high_pole: str, anchors) -> tuple[str, str | None]:
    """Describe the strength of a leaning and return the anchor for the favoured pole."""
    offset = value - 5
    if abs(offset) < 1:
        return "no clear leaning; neither pole dominates", None
    pole, anchor = (high_pole, anchors.high) if offset > 0 else (low_pole, anchors.low)
    strength = "strong" if abs(offset) >= 4 else "clear" if abs(offset) >= 2.5 else "mild"
    return f"{strength} leaning toward {pole.lower()}", anchor


def _scale_line(key: str, value: float, item: Dimension | Trait, anchors) -> list[str]:
    description, anchor = _leaning(value, item.low_pole, item.high_pole, anchors)
    lines = [f"- {key}: {value:g}/10 ({item.low_pole} <-> {item.high_pole}): {description}."]
    if anchor:
        lines.append(f"  At this end: {anchor}")
    return lines


def render_profile(profile: CognitiveProfile) -> str:
    sci = science()
    lines = [f"Name: {profile.name} ({profile.kind.value} profile)"]
    if profile.summary:
        lines.append(f"Summary: {profile.summary}")
    if profile.nuance:
        lines.append(f"Nuance: {profile.nuance}")
    if profile.priorities:
        lines.append(f"Priorities: {', '.join(profile.priorities)}")
    if profile.voice:
        lines.append(f"Voice: {profile.voice}")
    lines += ["", "Decision dimensions (0 = first pole, 10 = second pole):"]
    for dimension in sci.dimensions:
        lines += _scale_line(dimension.id, profile.value(dimension.id), dimension, dimension.reasoning)
    if profile.personality:
        lines += ["", "Personality, Big Five (0–10, 5 = population average):"]
        for trait in sci.personality.traits:
            lines += _scale_line(trait.id, profile.personality.traits[trait.id].value, trait, trait.anchors)
        if profile.personality.values:
            values = {v.id: v for v in sci.personality.values}
            named = [f"{values[v].name} ({values[v].definition.rstrip('.').lower()})" for v in profile.personality.values]
            lines.append(f"Values that matter most to this profile: {'; '.join(named)}.")
    if profile.context:
        context = profile.context
        lines.append("")
        if context.goals:
            lines.append(f"Goals: {'; '.join(context.goals)}")
        if context.constraints:
            lines.append(f"Constraints: {'; '.join(context.constraints)}")
        if context.notes:
            lines.append(f"Notes: {context.notes}")
    return "\n".join(lines)


def render_neural_context(signature: NeuralSignature, anatomy: list[Rating]) -> str:
    """The decision's anatomy and the mechanisms behavioural research documents for it, as
    prompt text. Brain maps are not part of it: they describe group-level literature, not a
    decision-maker, and Reticulate does not reason from them."""
    sci = science()
    rated = [r for r in sorted(anatomy, key=lambda r: -r.level) if r.level > 0]
    levels = {0: "absent", 1: "minor", 2: "present", 3: "central"}
    lines = ["Decision anatomy (rated 0 absent to 3 central):"]
    for r in rated:
        reason = f": {r.reason}" if r.reason else ""
        lines.append(f"- {sci.feature(r.feature_id).name}, {levels[r.level]}{reason}")
    if signature.mechanisms:
        lines += ["", "Mechanisms documented for decisions with these features (people on average):"]
        for m in signature.mechanisms:
            mechanism = sci.mechanism(m.mechanism_id)
            via = ", ".join(sci.feature(f).name.lower() for f in m.features)
            lines.append(f"- {mechanism.name} (through {via}, {levels[m.level]}). {mechanism.summary}")
            for e in mechanism.evidence:
                lines.append(f"  Evidence ({e.design.replace('_', ' ')}): {e.finding}")
    engaged = [d for d in signature.dimensions if d.weight > 0][:4]
    if engaged:
        names = ", ".join(sci.dimension(d.dimension_id).name.lower() for d in engaged)
        lines += ["", f"Profile dimensions this decision engages most: {names}."]
    return "\n".join(lines)


def render_problem(problem: Problem) -> str:
    text = f"<problem>\n{problem.question}\n</problem>"
    if problem.options:
        text += "\n\n<options>\n" + "\n".join(f"- {o}" for o in problem.options) + "\n</options>"
    if problem.context:
        text += f"\n\n<context>\n{problem.context}\n</context>"
    return text


def frame_prompt(problem: Problem) -> tuple[str, str]:
    return FRAME_SYSTEM, render_problem(problem) + "\n\nStructure this decision."


def analysis_prompt(problem: Problem) -> tuple[str, str]:
    sci = science()
    features = [{"id": f.id, "name": f.name, "question": f.question} for f in sci.features]
    mechanisms = [
        {
            "id": m.id,
            "name": m.name,
            "summary": m.summary,
            "linked_features": [f.id for f in sci.features if m.id in f.mechanisms],
            "countermove": m.countermove.text,
        }
        for m in sci.mechanisms
    ]
    user = (
        f"{render_problem(problem)}\n\n<decision_features>\n{json.dumps(features, indent=2)}\n</decision_features>\n\n"
        f"<mechanisms>\n{json.dumps(mechanisms, indent=2, ensure_ascii=False)}\n</mechanisms>\n\n"
        "Structure this decision, rate its anatomy and write the watch-outs."
    )
    return ANALYSIS_SYSTEM, user


def perspective_prompt(
    problem: Problem, frame: DecisionFrame, profile: CognitiveProfile, context: str | None = None
) -> tuple[str, str]:
    system = f"{PERSPECTIVE_SYSTEM}\n\n<profile>\n{render_profile(profile)}\n</profile>"
    user = f"{render_problem(problem)}\n\n<decision_frame>\n{frame.model_dump_json(indent=2)}\n</decision_frame>\n\n"
    if context:
        user += f"<neural_context>\n{context}\n</neural_context>\n\n"
    return system, user + "Reason through this decision as the profile."


def synthesis_prompt(
    problem: Problem,
    frame: DecisionFrame,
    profiles: list[CognitiveProfile],
    perspectives: dict,
    space: PerspectiveSpace,
    context: str | None = None,
) -> tuple[str, str]:
    traits = science().personality.trait_ids
    digest = [
        {
            "profile_id": p.id,
            "name": p.name,
            "dimensions": {d: p.value(d) for d in science().dimension_ids},
            "personality": {t: p.value(t) for t in traits} if p.personality else None,
            "recommendation": perspectives[p.id].recommendation,
            "summary": perspectives[p.id].summary,
            "conditions": perspectives[p.id].conditions,
        }
        for p in profiles
    ]
    user = (
        f"{render_problem(problem)}\n\n<decision_frame>\n{frame.model_dump_json(indent=2)}\n</decision_frame>\n\n"
        f"<perspectives>\n{json.dumps(digest, indent=2, ensure_ascii=False)}\n</perspectives>\n\n"
        f"<perspective_space>\n{space.model_dump_json(indent=2)}\n</perspective_space>\n\n"
    )
    if context:
        user += f"<neural_context>\n{context}\n</neural_context>\n\n"
    return SYNTHESIS_SYSTEM, user + "Explain this perspective space."


def _prompt_version() -> str:
    """Short hash of every template and renderer, recorded with each run."""
    source = (
        ANALYSIS_SYSTEM
        + PERSPECTIVE_SYSTEM
        + SYNTHESIS_SYSTEM
        + inspect.getsource(render_profile)
        + inspect.getsource(render_neural_context)
        + inspect.getsource(render_problem)
        + inspect.getsource(analysis_prompt)
    )
    return hashlib.sha256(source.encode()).hexdigest()[:12]


PROMPT_VERSION = _prompt_version()

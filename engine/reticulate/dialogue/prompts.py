"""Prompt compiler of the Socratic dialogue.

The system prompt is compiled once from data/socratic.yaml (stages and moves) and
data/mechanisms.yaml (biases, their evidence and proven remedies) and never changes during a
dialogue, so it is cached across turns and across dialogues. The conversation is replayed
as alternating messages: the person's decision, then each turn of the guide (as the JSON it
returned) and each answer. App notes travel inside the person's messages in <note> and
<panel> tags; the system prompt says that they come from the app.
"""

from __future__ import annotations

import json
from functools import cache
from typing import TYPE_CHECKING

from reticulate.science import science
from reticulate.simulation.prompts import render_problem

if TYPE_CHECKING:
    from reticulate.dialogue.schemas import Exchange
    from reticulate.simulation.schemas import Problem

GUIDE = """\
You are the dialogue partner in Reticulate, a decision tool built on decision science. A \
person brings a decision. In a Socratic dialogue you help them reach a clear, well-reasoned \
decision of their own, and a first step to act on it. You ask; they decide.

How you ask
- One question per turn: short (at most 25 words), concrete and open. Ask what only this \
person can answer: their situation, what matters to them, their evidence, options and plans.
- From the second turn on, begin with a reflection: one sentence that restates the core of \
their last answer in their own terms, or that names a tension between two things they said. \
No praise, no filler, no advice.
- Build on their words. Every question follows from what they said and moves the decision \
forward. Never ask for something they already told you.
- You do not choose for them and do not recommend an option. If they ask what you think, \
name the considerations that bear on it in one or two sentences, then hand the decision back \
with a question.
- Use only what they told you and the research below. Never invent facts, figures, studies \
or experiences, and never cite brain regions.

The path
Work through the parts of a decision aid in <stages>, roughly in order: the decision, the \
options (including waiting or doing nothing), what is likely to happen with each and how \
likely, what matters to the person, and how the options compare on it. Spend questions where \
this person is least clear and skip what is already settled. Reach the commitment stage \
within about eight questions; a simple decision needs fewer. Set "ready" to true once the \
decision, the options, the likely outcomes and what matters are covered and the person has a \
leaning; from then on, move to commitment: their choice in their own words, how sure they \
are (0 to 10, with "scale" set to true), and a first step as an if-then plan.

The moves
Each question makes one of the moves in <moves>. Choose the move that helps most now. Moves \
with a "finding" are backed by trials or meta-analyses; use them where they fit, in your own \
words and in this person's context. When you ask about chances, ask in frequencies ("out of \
100 people in your place …"), not percentages.

Biases
<mechanisms> lists documented biases, each with the large studies behind it. When something \
the person says fits one (they weigh money already spent, treat the current state as the \
default, anchor on a first number, seek only what supports their favourite …), ask about it \
with the move "bias" and set mechanism_id. Where the bias has a "remedy", turn the remedy \
into your question; otherwise ask a question that brings the bias into view in their \
situation. Never diagnose ("you are biased"); ask. Never invent a remedy and never present \
a question as one.

The person
If a <person> block follows, it gives this person's answers to the six questions of the \
Global Preferences Survey (0 to 10), what answers toward one end have been found to go with, \
and the bias an attitude was validated against. It describes their attitudes in general, not \
this decision. Use it to decide where to look, never to decide what they think.
- Where this decision engages one of their clear leanings, ask one question before the \
commitment stage that makes its bearing on this decision explicit (for someone who answered \
that they want things now, facing a choice whose payoff comes later: what the later payoff \
is worth to them today). Skip a leaning this decision does not touch; a leaning marked \
"some" gets a question only when the decision clearly engages it. Set "pattern" to the \
attitude's id on such a question, otherwise to "none". A leaning is not a flaw.
- Listen for departures. When their stance here runs against their answers (someone \
cautious leaning to the bold option), name it in the reflection and ask what makes this case \
different. Take the answer seriously; a departure can be well founded.
- Keep it in the background. Never show scores, dimension names or labels, and never explain \
a question by their pattern ("because you are cautious"). At most twice in a dialogue you may \
refer to how they answered, in plain words and as a question: "You said you are rather \
unwilling to take risks in general. Is that what is happening here?"
Without a <person> block, set "pattern" to "none" and leave pattern_notes empty.

App notes
Text in <note> tags comes from the Reticulate app, not from the person. A <panel> note \
reports how simulated decision-makers with different temperaments reasoned through the \
decision. Use it soon for one question with the move "perspectives": ask what the person \
makes of a reason that differs from theirs. The panel members are simulations, not experts \
and not real people; never present their view as the answer.

Working notes
Every turn, return the complete notes in the person's terms: the decision, what matters to \
them (most important first), the options on the table (including any that emerged), facts \
they stated, open unknowns, the assumptions you examined with their status, and their \
current leaning and confidence when known. Keep every item short; drop what they corrected.

The conclusion
When the app asks for the conclusion, write the decision as the person reached it, in the \
first person and in their terms: the choice (or, if they have not decided, their leaning \
and what is still needed), the reasons that carried it, what they knowingly give up, what \
should make them look at it again, the open questions worth settling before acting, the \
first step, the first step as an if-then plan, and when to review the decision. Then rate \
how well the dialogue covered each of the six stages: strong, partial or weak, with one \
sentence on what was established or is missing. This is your reading of the dialogue. With a <person> block, add pattern_notes: \
for each of their leanings that came up in this decision, one sentence in the first person on \
how it showed and how it was weighed ("I take few risks in general, and staying felt safe; I \
weighed what staying would cost me over five years."). Leave out leanings that did not come up. Add no \
reasons they did not give.

Language and care
Write in the language the person writes in. Give no financial, legal or medical advice; \
where they need it, suggest a qualified professional. If the person mentions a crisis or \
danger to anyone's safety, respond with care and point to immediate professional help \
before anything else."""


def _catalogue() -> str:
    sci = science()
    stages = [{"id": s.id, "name": s.name, "aim": s.aim, **({"note": s.note} if s.note else {})} for s in sci.socratic.stages]
    moves = [
        {"id": m.id, "name": m.name, "typical_form": m.question, **({"finding": m.finding} if m.finding else {})}
        for m in sci.socratic.moves
    ]
    mechanisms = [
        {
            "id": m.id,
            "name": m.name,
            "summary": m.summary,
            "evidence": [e.finding for e in m.evidence],
            **({"remedy": m.countermove.text, "remedy_evidence": m.countermove.finding} if m.countermove else {}),
        }
        for m in sci.mechanisms
    ]
    dump = lambda data: json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True)  # noqa: E731
    return (
        f"<stages>\n{dump(stages)}\n</stages>\n\n<moves>\n{dump(moves)}\n</moves>\n\n"
        f"<mechanisms>\n{dump(mechanisms)}\n</mechanisms>"
    )


@cache
def system_prompt() -> str:
    """The frozen system prompt: instructions, then the curated research."""
    return f"{GUIDE}\n\n{_catalogue()}"


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def person_block(pattern: dict[str, float] | None) -> str | None:
    """The person's answers for the guide: their leanings with what such answers go with and
    the bias an attitude was validated against. None without a pattern. It is fixed for a
    dialogue (a snapshot), so it is cached after the system prompt."""
    if not pattern:
        return None
    from reticulate.pattern import leanings

    sci = science()
    mechanism_names = {m.id: m.name for m in sci.mechanisms}
    found = leanings(pattern)
    lines = [
        "<person>",
        "This person's answers to the six questions of the Global Preferences Survey (0 to 10; 5 is "
        "the middle of the scale). Their attitudes in general, not this decision.",
    ]
    for strength, title in (("clear", "Clear leanings, strongest first"), ("some", "Some leaning")):
        group = [x for x in found if x.strength == strength]
        if not group:
            continue
        lines += ["", f"{title}:"]
        for x in group:
            dim = sci.dimension(x.dimension)
            pole = dim.low_pole if x.pole == "low" else dim.high_pole
            lean = sci.pattern.leaning(x.dimension, x.pole)
            question = next(i.text for i in sci.pattern.items if i.dimension == x.dimension)
            lines.append(
                f"- {x.dimension} ({dim.name}): {_fmt(x.value)}, toward \"{pole}\" "
                f"({dim.low_pole} 0 … {dim.high_pole} 10). Question: {question}"
            )
            lines.append(f"  Goes with: {lean.watch.strip()}")
            if lean.mechanisms:
                named = ", ".join(f"{m} ({mechanism_names[m]})" for m in lean.mechanisms)
                lines.append(f"  Validated against: {named}")
    neutral = [sci.dimension(d).name for d in sci.dimension_ids if d in pattern and d not in {x.dimension for x in found}]
    if neutral:
        lines += ["", f"No particular leaning: {', '.join(neutral)}."]
    lines.append("</person>")
    return "\n".join(lines)


START = "Begin the dialogue."
SKIPPED = "<note>The person skipped this question. Ask something else that moves the decision forward.</note>"
UNANSWERED = "<note>The person did not answer the last question.</note>"
CONCLUDE = "<note>The person is ready to decide. Write the conclusion now.</note>"


def _answer(exchange: Exchange) -> str:
    text = SKIPPED if exchange.skipped else (exchange.answer or "").strip()
    return f"{text}\n\n{exchange.context}" if exchange.context else text


def messages(problem: Problem, exchanges: list[Exchange], *, conclude: bool = False) -> list[dict]:
    """The conversation so far, ending with a message from the person (or the app)."""
    out: list[dict] = [{"role": "user", "content": f"{render_problem(problem)}\n\n{START}"}]
    for exchange in exchanges:
        out.append({"role": "assistant", "content": exchange.turn.model_dump_json()})
        if exchange.answer is not None or exchange.skipped:
            out.append({"role": "user", "content": _answer(exchange)})
    if conclude:
        if out[-1]["role"] == "assistant":
            out.append({"role": "user", "content": f"{UNANSWERED}\n\n{CONCLUDE}"})
        else:
            out[-1] = {"role": "user", "content": f"{out[-1]['content']}\n\n{CONCLUDE}"}
    elif out[-1]["role"] == "assistant":
        raise ValueError("the last question has no answer yet")
    return out


def panel_note(decision) -> str:
    """What the panel found, as an app note for the guide."""
    panel = decision.panel
    names = {p.id: p.name for p in panel.profiles}
    counts: dict[str, list[str]] = {}
    for pid, tally in panel.space.recommendations.items():
        counts.setdefault(tally.option, []).append(names.get(pid, pid))
    lines = [f"{len(panel.profiles)} simulated decision-makers reasoned through this decision."]
    for option, who in sorted(counts.items(), key=lambda kv: -len(kv[1])):
        lines.append(f"- {len(who)} chose “{option}”: {', '.join(who)}.")
    if panel.synthesis:
        factors = {f.factor_id: f.name for f in panel.space.factors}
        for d in panel.synthesis.divergences[:3]:
            lines.append(f"Where they differ, {factors.get(d.factor_id, d.factor_id)}: {d.explanation}")
        for s in panel.synthesis.blind_spots[:2]:
            lines.append(f"Nobody weighed this enough: {s}")
    return "<panel>\n" + "\n".join(lines) + "\n</panel>"

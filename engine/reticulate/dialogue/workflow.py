"""The Socratic dialogue of a decision.

The calls to the engine (`first_turn`, `next_turn`, `conclusion`) only read a decision; the
functions that change it (`record_answer`, `add_turn`, `conclude`, `revise`, `reopen`,
`queue_note`) are pure and return a copy. The API applies them to the latest saved record,
so a long engine call never overwrites what changed meanwhile.
"""

from __future__ import annotations

import hashlib
import inspect
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from reticulate.dialogue import prompts
from reticulate.dialogue.schemas import Conclusion, Dialogue, DialogueMeta, Exchange, SocraticTurn
from reticulate.science import science
from reticulate.simulation.engines import ReasoningEngine, total, track_usage
from reticulate.simulation.schemas import Usage

if TYPE_CHECKING:
    from reticulate.decision.schemas import Decision

MAX_EXCHANGES = 30
MAX_ANSWER = 4000


def _version() -> str:
    source = (
        prompts.system_prompt()
        + inspect.getsource(prompts.messages)
        + inspect.getsource(prompts._answer)
        + prompts.SKIPPED
        + prompts.UNANSWERED
        + prompts.CONCLUDE
        + str(SocraticTurn.model_json_schema())
        + str(Conclusion.model_json_schema())
    )
    return hashlib.sha256(source.encode()).hexdigest()[:12]


PROMPT_VERSION = _version()


def new_dialogue(engine: ReasoningEngine | None) -> Dialogue:
    return Dialogue(
        meta=DialogueMeta(
            prompt_version=PROMPT_VERSION,
            model=getattr(engine, "model", None),
            effort=getattr(engine, "dialogue_effort", None),
        )
    )


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def normalise_turn(turn: SocraticTurn) -> SocraticTurn:
    """Unknown mechanisms become 'none'; confidence stays within -1…10; lists lose duplicates."""
    known = {m.id for m in science().mechanisms}
    notes = turn.notes

    def unique(items: list[str]) -> list[str]:
        seen: dict[str, str] = {}
        for item in items:
            text = item.strip()
            if text and text.lower() not in seen:
                seen[text.lower()] = text
        return list(seen.values())

    notes = notes.model_copy(
        update={
            "goals": unique(notes.goals),
            "options": unique(notes.options),
            "facts": unique(notes.facts),
            "unknowns": unique(notes.unknowns),
            "confidence": _clamp(notes.confidence, -1, 10),
        }
    )
    return turn.model_copy(
        update={
            "mechanism_id": turn.mechanism_id if turn.mechanism_id in known else "none",
            "question": turn.question.strip(),
            "reflection": turn.reflection.strip(),
            "notes": notes,
        }
    )


def normalise_conclusion(conclusion: Conclusion) -> Conclusion:
    """One quality check per stage, in the order of the science layer."""
    by_stage = {q.stage: q for q in conclusion.quality}
    ordered = [by_stage[s.id] for s in science().socratic.stages if s.id in by_stage]
    return conclusion.model_copy(update={"quality": ordered})


# --- engine calls -------------------------------------------------------------------------


async def first_turn(decision: Decision, engine: ReasoningEngine) -> tuple[SocraticTurn, Usage]:
    with track_usage() as calls:
        turn = await engine.ask(decision.problem, [])
    return normalise_turn(turn), total(calls)


async def next_turn(decision: Decision, engine: ReasoningEngine) -> tuple[SocraticTurn, Usage]:
    dialogue = _dialogue(decision)
    if not dialogue.exchanges:
        return await first_turn(decision, engine)
    if dialogue.open is not None:
        raise ValueError("answer the open question first")
    if len(dialogue.exchanges) >= MAX_EXCHANGES:
        raise ValueError(f"the dialogue has reached {MAX_EXCHANGES} questions; conclude it")
    with track_usage() as calls:
        turn = await engine.ask(decision.problem, dialogue.exchanges)
    return normalise_turn(turn), total(calls)


async def conclusion(decision: Decision, engine: ReasoningEngine) -> tuple[Conclusion, Usage]:
    dialogue = _dialogue(decision)
    if not dialogue.exchanges:
        raise ValueError("there is nothing to conclude yet")
    with track_usage() as calls:
        result = await engine.conclude(decision.problem, dialogue.exchanges)
    return normalise_conclusion(result), total(calls)


# --- changes to the record ----------------------------------------------------------------


def _dialogue(decision: Decision) -> Dialogue:
    if decision.dialogue is None:
        raise ValueError("this decision has no dialogue")
    return decision.dialogue


def _with(decision: Decision, dialogue: Dialogue, usage: Usage | None = None) -> Decision:
    update: dict = {"dialogue": dialogue, "updated_at": datetime.now(UTC)}
    if usage is not None:
        update["usage"] = decision.usage.merge(usage)
    return decision.model_copy(update=update)


def record_answer(decision: Decision, answer: str | None, skipped: bool = False) -> Decision:
    """Fill in the open question's answer; app notes waiting for it go out with it."""
    dialogue = _dialogue(decision)
    if dialogue.conclusion is not None:
        raise ValueError("the dialogue is concluded; reopen it to continue")
    open_ = dialogue.open
    if open_ is None:
        raise ValueError("there is no open question")
    text = (answer or "").strip()[:MAX_ANSWER]
    if not text and not skipped:
        raise ValueError("write an answer or skip the question")
    answered = open_.model_copy(
        update={
            "answer": None if skipped else text,
            "skipped": skipped,
            "answered_at": datetime.now(UTC),
            "context": "\n\n".join(dialogue.pending) or None,
        }
    )
    exchanges = [*dialogue.exchanges[:-1], answered]
    return _with(decision, dialogue.model_copy(update={"exchanges": exchanges, "pending": []}))


def add_turn(decision: Decision, turn: SocraticTurn, usage: Usage, expected: int) -> Decision:
    """Append the guide's next turn, if the dialogue still has `expected` exchanges."""
    dialogue = _dialogue(decision)
    if len(dialogue.exchanges) != expected or dialogue.open is not None or dialogue.conclusion is not None:
        raise ValueError("the dialogue changed while the next question was being written")
    exchange = Exchange(turn=turn, asked_at=datetime.now(UTC), usage=usage)
    return _with(decision, dialogue.model_copy(update={"exchanges": [*dialogue.exchanges, exchange]}), usage)


def conclude(decision: Decision, result: Conclusion, usage: Usage, expected: int) -> Decision:
    dialogue = _dialogue(decision)
    if len(dialogue.exchanges) != expected:
        raise ValueError("the dialogue changed while the conclusion was being written")
    return _with(
        decision,
        dialogue.model_copy(update={"conclusion": result, "concluded_at": datetime.now(UTC), "conclusion_usage": usage}),
        usage,
    )


def revise(decision: Decision, index: int) -> Decision:
    """Go back to question `index`: its answer and everything after it are dropped."""
    dialogue = _dialogue(decision)
    if not 0 <= index < len(dialogue.exchanges):
        raise ValueError("no such question")
    kept = dialogue.exchanges[: index + 1]
    reopened = kept[-1].model_copy(update={"answer": None, "skipped": False, "answered_at": None, "context": None})
    # Notes that went out with the dropped answers go out again with the next one.
    resent = [e.context for e in dialogue.exchanges[index:] if e.context]
    pending = [*resent, *dialogue.pending]
    return _with(
        decision,
        dialogue.model_copy(
            update={
                "exchanges": [*kept[:-1], reopened],
                "pending": pending,
                "conclusion": None,
                "concluded_at": None,
                "conclusion_usage": None,
            }
        ),
    )


def reopen(decision: Decision) -> Decision:
    """Set the conclusion aside and continue the dialogue."""
    dialogue = _dialogue(decision)
    return _with(decision, dialogue.model_copy(update={"conclusion": None, "concluded_at": None, "conclusion_usage": None}))


def queue_note(decision: Decision, note: str) -> Decision:
    """An app note (such as the panel's result) to send with the person's next answer."""
    if decision.dialogue is None or decision.dialogue.conclusion is not None:
        return decision
    dialogue = decision.dialogue
    return _with(decision, dialogue.model_copy(update={"pending": [*dialogue.pending, note]}))

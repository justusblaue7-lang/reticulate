"""The Socratic dialogue: questions that lead a person to a decision of their own."""

from reticulate.dialogue.schemas import Conclusion, Dialogue, Exchange, Notes, SocraticTurn
from reticulate.dialogue.workflow import (
    PROMPT_VERSION,
    add_turn,
    conclude,
    conclusion,
    first_turn,
    new_dialogue,
    next_turn,
    queue_note,
    record_answer,
    reopen,
    revise,
)

__all__ = [
    "PROMPT_VERSION",
    "Conclusion",
    "Dialogue",
    "Exchange",
    "Notes",
    "SocraticTurn",
    "add_turn",
    "conclude",
    "conclusion",
    "first_turn",
    "new_dialogue",
    "next_turn",
    "queue_note",
    "record_answer",
    "reopen",
    "revise",
]

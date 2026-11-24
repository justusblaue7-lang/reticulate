"""Data shapes of the Socratic dialogue.

SocraticTurn and Conclusion double as structured-output schemas for the reasoning engine,
so they carry no numeric constraints; values are clamped after parsing. Stage and move ids
come from data/socratic.yaml, so the schema always matches the science layer.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from reticulate.science import science
from reticulate.simulation.schemas import Usage

StageId = Literal[tuple(s.id for s in science().socratic.stages)]  # type: ignore[valid-type]
MoveId = Literal[tuple(m.id for m in science().socratic.moves)]  # type: ignore[valid-type]

# The moves of dialogues saved before science 1.0, mapped to the move that replaced them, so
# that every saved decision still opens.
LEGACY_MOVES = {
    "goal": "values",
    "alternative": "options",
    "consequence": "outcomes",
    "perspective": "perspectives",
    "tradeoff": "values",
    "assumption": "check",
    "evidence": "check",
    "opposite": "check",
    "premortem": "check",
}


class Assumption(BaseModel):
    text: str = Field(description="The assumption, in the person's terms")
    status: Literal["open", "holds", "shaky", "dropped"] = Field(
        description="open: not examined yet; holds: the person gave good reason for it; "
        "shaky: the support is thin or mixed; dropped: the person let go of it"
    )


class Notes(BaseModel):
    """The working notes: where the decision stands, in the person's terms."""

    decision: str = Field(description="The decision as the person now frames it, in one sentence")
    goals: list[str] = Field(description="What matters to the person, most important first, in their words")
    options: list[str] = Field(description="The options on the table, including any that emerged in the dialogue")
    facts: list[str] = Field(description="Facts the person stated")
    unknowns: list[str] = Field(description="Open questions whose answers could change the decision")
    assumptions: list[Assumption] = Field(description="Assumptions examined so far, with their status")
    leaning: str = Field(description="The option the person currently leans toward, or an empty string")
    confidence: int = Field(description="How sure the person said they are, 0 to 10, or -1 if not known")


class SocraticTurn(BaseModel):
    """One turn of the guide: a reflection, one question, and the updated notes."""

    reflection: str = Field(
        description="One sentence restating the core of the person's last answer or naming a tension "
        "between two things they said; empty on the first turn"
    )
    question: str = Field(description="Exactly one open question, at most 25 words")
    move: MoveId = Field(description="The move this question makes")
    stage: StageId = Field(description="The part of the decision this question works on")
    mechanism_id: str = Field(
        description="id of the bias this question asks about, or 'none'"
    )
    pattern: str = Field(
        description="id of the attitude in <person> whose leaning this question asks about, or 'none'"
    )
    why: str = Field(description="Why this question now, in one short sentence addressed to the person")

    @field_validator("move", mode="before")
    @classmethod
    def _legacy_move(cls, value: object) -> object:
        return LEGACY_MOVES.get(value, value) if isinstance(value, str) else value
    scale: bool = Field(description="True when the question asks for a number from 0 to 10")
    notes: Notes
    ready: bool = Field(
        description="True once the frame, what matters, the options and the key unknowns are covered "
        "and the person has a leaning"
    )

    @model_validator(mode="before")
    @classmethod
    def _earlier_builds(cls, data):
        # Records written before 0.6 have no pattern field; the schema keeps it required.
        if isinstance(data, dict) and "pattern" not in data:
            data = {**data, "pattern": "none"}
        return data


class QualityCheck(BaseModel):
    stage: StageId
    level: Literal["strong", "partial", "weak"]
    note: str = Field(description="What the dialogue established, or what is missing, in one sentence")


class PatternNote(BaseModel):
    dimension: str = Field(description="id of a dimension in <person>")
    note: str = Field(
        description="In the first person: how this leaning showed in the decision and how it was checked, one sentence"
    )


class Conclusion(BaseModel):
    """The decision as the person reached it in the dialogue."""

    decided: bool = Field(description="False when the person has not settled on an option yet")
    choice: str = Field(description="The option the person chose, or their leaning if undecided")
    statement: str = Field(
        description="The decision in the first person and in the person's own terms, one or two sentences"
    )
    reasons: list[str] = Field(description="The reasons that carried the decision, as the person gave them")
    tradeoffs: list[str] = Field(description="What the person knowingly gives up")
    revisit_if: list[str] = Field(description="Signals or events that should make the person look at it again")
    open_questions: list[str] = Field(description="What is still unknown and worth settling before acting")
    first_step: str = Field(description="The first concrete step")
    if_then: str = Field(description="The first step as a plan: 'If (or when) …, then I will …'")
    review: str = Field(description="When to look at the decision again, e.g. 'in three months' or a date")
    quality: list[QualityCheck] = Field(description="One check per element of decision quality, in order")
    pattern_notes: list[PatternNote] = Field(
        description="For leanings in <person> that came up in this decision: how each showed and was checked. "
        "Empty without a <person> block or when none came up"
    )

    @model_validator(mode="before")
    @classmethod
    def _earlier_builds(cls, data):
        if isinstance(data, dict) and "pattern_notes" not in data:
            data = {**data, "pattern_notes": []}
        return data


# --- the record ---------------------------------------------------------------------------


class Exchange(BaseModel):
    """A question of the guide and the person's answer."""

    turn: SocraticTurn
    asked_at: datetime
    answer: str | None = None  # None while the question is open
    skipped: bool = False
    answered_at: datetime | None = None
    context: str | None = None  # notes from the app sent along with the answer (e.g. the panel's result)
    usage: Usage = Usage()


class DialogueMeta(BaseModel):
    prompt_version: str
    model: str | None
    effort: str | None


class Dialogue(BaseModel):
    # The person's self-rated pattern when the dialogue started (0–10 per dimension), or None.
    pattern: dict[str, float] | None = None
    pattern_at: datetime | None = None
    exchanges: list[Exchange] = []
    pending: list[str] = []  # app notes waiting to go out with the next answer
    conclusion: Conclusion | None = None
    concluded_at: datetime | None = None
    conclusion_usage: Usage | None = None
    meta: DialogueMeta

    @property
    def notes(self) -> Notes | None:
        return self.exchanges[-1].turn.notes if self.exchanges else None

    @property
    def open(self) -> Exchange | None:
        """The question waiting for an answer, if any."""
        if self.exchanges and self.exchanges[-1].answer is None and not self.exchanges[-1].skipped:
            return self.exchanges[-1]
        return None

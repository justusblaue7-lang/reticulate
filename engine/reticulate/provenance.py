"""Where a number comes from.

Every score and every brain quantity in Reticulate carries a provenance label, so the
interface can keep measurement, inference, literature and design apart. See
docs/epistemics.md.
"""

from enum import StrEnum


class Provenance(StrEnum):
    MEASURED = "measured"  # observed for this person: task, questionnaire or recording
    INFERRED = "inferred"  # predicted for this person by a validated statistical model
    META_ANALYTIC = "meta-analytic"  # aggregated from published group-level studies
    AUTHORED = "authored"  # set by a person: persona design, slider, counterfactual

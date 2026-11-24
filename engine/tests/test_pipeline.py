import pytest

from reticulate import runs
from reticulate.simulation import sensitivity, simulate
from tests.fakes import FakeEngine, GO, STAY


async def test_simulation_with_replicates(library, problem):
    profiles = [library.get(i) for i in ("insurance_claims_clerk", "software_founder")]
    result = await simulate(problem, profiles, FakeEngine(jitter=True), replicates=3)
    assert all(len(v) == 3 for v in result.perspectives.values())
    downside = next(f for f in result.space.factors if f.factor_id == "downside_risk")
    officer = downside.weights["insurance_claims_clerk"]
    assert officer.n == 3 and officer.min <= officer.mean <= officer.max and officer.max - officer.min == 2
    assert downside.contested
    assert result.space.recommendations["insurance_claims_clerk"].option == STAY
    assert result.space.recommendations["software_founder"].option == GO
    assert result.meta.replicates == 3 and result.meta.prompt_version


async def test_single_replicate_is_flagged(library, engine, problem):
    result = await simulate(problem, [library.get("apprentice_carpenter"), library.get("primary_teacher")], engine)
    assert any("Fewer than three replicates" in n for n in result.space.notes)


async def test_duplicate_profiles_are_rejected(library, engine, problem):
    p = library.get("apprentice_carpenter")
    with pytest.raises(ValueError, match="unique"):
        await simulate(problem, [p, p], engine)


async def test_dose_response_recovers_the_varied_dimension(library, problem):
    base = library.get("insurance_claims_clerk")
    result = await sensitivity(problem, base, "risk_taking", [10, 0, 5], FakeEngine(), replicates=2)
    assert result.values == [0.0, 5.0, 10.0]
    curves = {c.factor_id: c for c in result.curves}
    assert curves["upside_potential"].slope == pytest.approx(1.0)
    assert curves["downside_risk"].slope == pytest.approx(-1.0)
    assert curves["long_term_position"].slope == pytest.approx(0.0)  # held fixed
    assert result.recommendations["0"].option == STAY


async def test_dose_response_validates_values(library, engine, problem):
    with pytest.raises(ValueError, match="distinct values"):
        await sensitivity(problem, library.get("apprentice_carpenter"), "risk_taking", [5], engine)


async def test_runs_are_saved_and_listed(library, engine, problem, runs_dir):
    result = await simulate(problem, [library.get("apprentice_carpenter")], engine)
    path = runs.save(result)
    assert path.parent == runs_dir
    summary = runs.list_runs()[0]
    assert summary.id == result.id and summary.kind == "simulation"
    assert runs.load(result.id)["frame"]["decision"] == problem.question


async def test_progress_counts_every_engine_call(library, engine, problem):
    from reticulate.simulation.pipeline import Progress, report_progress

    profiles = [library.get(i) for i in ("apprentice_carpenter", "primary_teacher")]
    progress = Progress("panel", total=2 * 2 + 2)
    with report_progress(progress):
        await simulate(problem, profiles, engine, replicates=2)
    assert progress.done == progress.total == 6
    assert progress.labels == {"apprentice_carpenter": 2, "primary_teacher": 2, "frame": 1, "synthesis": 1}

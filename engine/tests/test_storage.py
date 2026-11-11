"""The data folder: decision folders, the readable copy, deleting, and moving older records."""

import json
from datetime import UTC, datetime

from reticulate import runs
from reticulate.decision import create
from reticulate.decision.schemas import Rating
from reticulate.simulation.schemas import Problem

PROBLEM = Problem(question="Sollen wir im Frühjahr ein zweites Café eröffnen?", options=["Eröffnen", "Warten"])


def _decision():
    return create(PROBLEM, None, [Rating(feature_id="possible_loss", level=3)])


def test_a_decision_gets_its_own_folder_with_a_readable_copy(data_dir):
    decision = _decision()
    path = runs.save(decision)
    folder = path.parent
    assert path.name == "decision.json" and folder.parent == data_dir / "decisions"
    assert folder.name == f"{decision.created_at:%Y-%m-%d}-sollen-wir-im-fruhjahr-ein-zweites-cafe-eroffnen-{decision.id[:8]}"
    assert (folder / "decision.md").read_text().startswith("# Sollen wir im Frühjahr")
    runs.save(decision.model_copy(update={"settled": ["x"]}))  # saving again rewrites the same folder
    assert len(list((data_dir / "decisions").iterdir())) == 1 and runs.load_decision(decision.id).settled == ["x"]
    assert runs.folder(decision.id) == folder
    runs.delete(decision.id)
    assert not folder.exists() and runs.list_runs("decision") == []


def test_records_of_earlier_builds_move_into_the_data_folder(tmp_path, data_dir):
    legacy_runs, legacy_avatars = tmp_path / "engine_runs", tmp_path / "engine_avatars"
    legacy_runs.mkdir()
    legacy_avatars.mkdir()
    decision = _decision()
    old = legacy_runs / f"{decision.created_at:%Y%m%d-%H%M%S}-decision-{decision.id[:8]}.json"
    data = json.loads(decision.model_dump_json())
    for key in ("dialogue", "analysis", "analysis_error", "settled"):  # a 0.4 record has none of these
        data.pop(key)
    old.write_text(json.dumps(data))
    (legacy_runs / "20261101-120000-simulation-abcdef12.json").write_text(json.dumps({"id": "abcdef12" * 4, "kind": "simulation"}))
    (legacy_avatars / "mine.yaml").write_text("id: mine\n")

    moved = runs.migrate_legacy(legacy_runs, legacy_avatars)
    assert len(moved) == 3
    assert runs.load_decision(decision.id).problem == PROBLEM
    assert (data_dir / "runs" / "20261101-120000-simulation-abcdef12.json").exists()
    assert (data_dir / "avatars" / "mine.yaml").read_text() == "id: mine\n"
    assert not legacy_runs.exists() and not legacy_avatars.exists()


def test_listing_shows_the_newest_first_and_skips_stray_files(data_dir):
    first, second = _decision(), _decision()
    second = second.model_copy(update={"updated_at": datetime(2030, 1, 1, tzinfo=UTC)})
    runs.save(first)
    runs.save(second)
    (data_dir / "decisions" / "stray").mkdir()
    (data_dir / "decisions" / "stray" / "decision.json").write_text("{}")
    listed = runs.list_runs("decision")
    assert [s.id for s in listed] == [second.id, first.id] and listed[0].status == "rated"

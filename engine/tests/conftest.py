import pytest

from reticulate.config import settings
from reticulate.library import default_library
from reticulate.simulation import Problem
from tests.fakes import FakeEngine


@pytest.fixture(autouse=True)
def runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("RETICULATE_RUNS_DIR", str(tmp_path / "runs"))
    settings.cache_clear()
    yield tmp_path / "runs"
    settings.cache_clear()


@pytest.fixture
def library():
    return default_library()


@pytest.fixture
def engine():
    return FakeEngine()


@pytest.fixture
def problem():
    return Problem(
        question="I have €70,000 invested in ETFs. Should I invest €40,000 for 33% of a new "
        "pickleball facility in Lübbecke?"
    )

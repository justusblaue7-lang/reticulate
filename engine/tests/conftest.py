import pytest

from reticulate.config import settings
from reticulate.library import default_library
from reticulate.simulation import Problem
from tests.fakes import FakeEngine


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """Every test writes into its own data folder, never into the project's."""
    monkeypatch.setenv("RETICULATE_DATA_DIR", str(tmp_path / "data"))
    settings.cache_clear()
    yield tmp_path / "data"
    settings.cache_clear()


@pytest.fixture
def runs_dir(data_dir):
    return data_dir / "runs"


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

from fastapi import FastAPI

from tests.core.app_source import api_routes, application


def test_the_route_reader_refuses_a_mounted_application():
    """Every route sweep reads `api_routes`, which opens no mount: a person's write served by a mounted app would pass them all."""

    mounting = FastAPI()
    mounting.mount("/api/v0/mounted", FastAPI())

    try:
        list(api_routes(mounting))
    except AssertionError as refusal:
        assert "mounts routes" in str(refusal)
    else:
        raise AssertionError("a mounted application was read as serving nothing")


def test_the_application_mounts_nothing():
    """The control: the reader refusing every application would pass the case above."""

    assert list(api_routes(application()))

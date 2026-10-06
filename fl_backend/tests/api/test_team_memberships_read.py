import json
from collections.abc import Mapping
from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.services import find_saison_frist_refusal, hash_token
from app.api.teams.admin_router import get_team_memberships
from app.api.teams.schemas import FLTeamMembership, FLTeamsMembershipsResponse
from app.api.teams.services import build_team_memberships_pipeline, compose_kontakt_bestaetigung
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document, saison_team_document, team_document
from tests.worker import worker_database


class TestTheMembershipsPipeline:
    def test_it_filters_nothing_out(self):
        # No `$match` at all: retired teams and teams in no season are what the admin list must show.
        stages = [next(iter(stage)) for stage in build_team_memberships_pipeline()]
        assert "$match" not in stages

    def test_the_lookup_projects_exactly_what_the_membership_model_declares(self):
        """Against the MODEL, not a hand-copied list: a field added to the junction reaches this read only by being named on both."""

        lookup = next(stage["$lookup"] for stage in build_team_memberships_pipeline() if "$lookup" in stage)
        assert lookup["from"] == "saison_teams"
        projection = lookup["pipeline"][0]["$project"]
        assert projection == {"_id": 0} | {name: 1 for name in FLTeamMembership.model_fields}

    def test_it_sorts_by_name(self):
        assert build_team_memberships_pipeline()[-1] == {"$sort": {"name": 1}}


class TestTheResponseModel:
    def test_an_empty_membership_list_is_a_valid_club(self):
        response = FLTeamsMembershipsResponse.model_validate(
            {
                "acknowledged": 1,
                "teams": [
                    {
                        "_id": "69ea37a048b415de4f59417b",
                        "name": "Muster",
                        "shorthand": "MU",
                        "description": "",
                        "full_name": "Musterschule",
                        "website_url": "https://example.org",
                        "address": {"strasse": "Weg", "hausnummer": "1", "plz": "60313", "stadtteil": "", "stadt": "Frankfurt"},
                        "inactive_since": None,
                        "memberships": [],
                    }
                ],
            }
        )
        assert response.teams[0].memberships == []


DATABASE_NAME = worker_database("fl_team_memberships_test")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607990001")
ZUSTELLUNG = {"nachricht_id": "msg-trainer", "stand": "zugestellt", "grund": None, "am": "2026-03-02T09:00:00.000000+00:00"}
TODAY = "2026-03-01"


def read_the_links(mongo_replica_set_url: str, bestaetigungen: Mapping[str, Any]) -> tuple[Any, dict[str, Any]]:
    """The pipeline's raw rows and the read's served seat links, over one club holding two seats on one season row."""

    async def run() -> Any:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Muster", "MU"))
            await database[Collection.SAISON_TEAMS].insert_one(
                saison_team_document(
                    "2026",
                    TEAM_OID,
                    "Muster",
                    "MU",
                    kontakte={
                        "trainer": kontaktperson_document("Anke"),
                        "ansprechperson": kontaktperson_document("Bert"),
                        "stellvertretung": None,
                        "trainer_ist_zugleich": None,
                    },
                    bestaetigungen={"stellvertretung": None, **bestaetigungen},
                )
            )
            roh = await aggregate_many_from_db(collection=database[Collection.TEAMS], pipeline=build_team_memberships_pipeline())
            return roh, await get_team_memberships(teams_collection=database[Collection.TEAMS], today=TODAY)

    roh, response = on_the_seed_loop(run())
    [membership] = response.teams[0].memberships

    return roh, membership.model_dump(mode="json")["bestaetigungen"]


@pytest.mark.db
def test_each_seats_link_is_served_by_its_state_and_never_by_its_hash(mongo_replica_set_url: str):
    """The contacts editor shows each seat's link as the referee editor shows the referee's: sent, due and delivered."""

    trainer_link = {**compose_kontakt_bestaetigung(token_hash=hash_token("trainer-link"), today=TODAY), "zustellung": ZUSTELLUNG}
    roh, served = read_the_links(mongo_replica_set_url, {"trainer": trainer_link, "ansprechperson": None})

    assert served == {
        "trainer": {
            "verschickt_am": TODAY,
            "frist": trainer_link["frist"],
            "abgelehnt_am": None,
            "zustellung": ZUSTELLUNG,
            "abgelaufen": False,
        },
        "ansprechperson": None,
        "stellvertretung": None,
    }
    # Twice: the read drops the hash, and the model declares none, so neither alone carries it to the wire.
    assert "token_hash" not in json.dumps(roh, default=str)
    assert "token_hash" not in json.dumps(served)


@pytest.mark.db
def test_a_link_reads_as_lapsed_exactly_where_its_press_refuses(mongo_replica_set_url: str):
    """Its deadline's own day still answers, the day after does not: the read and the press judge one rule at one date."""

    def link(name: str, frist: str) -> dict[str, Any]:
        return {**compose_kontakt_bestaetigung(token_hash=hash_token(name), today="2026-02-01"), "frist": frist}

    _, served = read_the_links(
        mongo_replica_set_url, {"trainer": link("due-today", TODAY), "ansprechperson": link("due-yesterday", "2026-02-28")}
    )
    seats = [served["trainer"], served["ansprechperson"]]

    assert [seat["abgelaufen"] for seat in seats] == [False, True]
    assert [find_saison_frist_refusal(frist=seat["frist"], today=TODAY) is not None for seat in seats] == [False, True]

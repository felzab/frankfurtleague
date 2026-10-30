import json
import time
from collections.abc import Mapping, Sequence
from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.services import find_saison_frist_refusal
from app.api.postausgang.schemas import FLPostausgangEreignisPayload, FLPostausgangZustellStand
from app.api.postausgang.services import enqueue_mails
from app.api.postausgang.system_router import post_ereignis
from app.api.teams.admin_router import get_team_saisons
from app.api.teams.schemas import FLTeamMembership, FLTeamsSaisonsResponse
from app.api.teams.services import build_team_saisons_pipeline, compose_kontakt_bestaetigung, owed_kontakt_link
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from app.shared.schemas.literals import FLKontaktRolle
from app.shared.tokens import hash_token
from tests.config import ADMINISTRATORS
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document, saison_team_document, team_document
from tests.postausgang import MAIL_NOW, drained
from tests.worker import worker_database


class TestTheSaisonsPipeline:
    def test_it_filters_nothing_out(self):
        # No `$match` at all: retired teams and teams in no season are what the admin list must show.
        stages = [next(iter(stage)) for stage in build_team_saisons_pipeline()]
        assert "$match" not in stages

    def test_the_lookup_projects_exactly_what_the_membership_model_declares(self):
        """Against the MODEL, not a hand-copied list: a field added to the junction reaches this read only by being named on both."""

        lookup = next(stage["$lookup"] for stage in build_team_saisons_pipeline() if "$lookup" in stage)
        assert lookup["from"] == "saison_teams"
        projection = lookup["pipeline"][0]["$project"]
        # Composed after the read, off the seats' addresses; the row's id keys the read of its links' mails.
        composed = {"adresswechsel"}
        assert projection == {"_id": 1} | {name: 1 for name in FLTeamMembership.model_fields if name not in composed}


class TestTheResponseModel:
    def test_an_empty_membership_list_is_a_valid_club(self):
        response = FLTeamsSaisonsResponse.model_validate(
            {
                "teams": [
                    {
                        "_id": "69ea37a048b415de4f59417b",
                        "name": "Muster",
                        "shorthand": "MUX",
                        "description": "",
                        "full_name": "Musterschule",
                        "website_url": "https://example.org",
                        "address": {"strasse": "Weg", "hausnummer": "1", "plz": "60313", "stadtteil": "", "stadt": "Frankfurt"},
                        "schulform": None,
                        "inactive_since": None,
                        "memberships": [],
                    }
                ],
            }
        )
        assert response.teams[0].memberships == []


DATABASE_NAME = worker_database("fl_team_saisons_test")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607990001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607990011")
TODAY = "2026-03-01"

# Owed is the seats a mail's link answers, the event what the provider then reported about it, `None` for none yet.
Owed = tuple[tuple[FLKontaktRolle, ...], FLPostausgangZustellStand | None]


def read_the_links(
    mongo_replica_set_url: str,
    bestaetigungen: Mapping[str, Any],
    *,
    kontakte: Mapping[str, Any] | None = None,
    owed: Sequence[Owed] = (),
) -> tuple[Any, dict[str, Any]]:
    """The pipeline's raw rows and the read's served seat links, over one club holding seats on one season row.

    Each of `owed` is a link mail owed about the row as its writes owe one, then sent, then reported on.
    """

    async def run() -> Any:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (client, database):
            block = {
                "trainer": kontaktperson_document("Anke"),
                "ansprechperson": kontaktperson_document("Bert"),
                "stellvertretung": None,
                "trainer_ist_zugleich": None,
                **(kontakte or {}),
            }
            row = {
                "_id": ROW_OID,
                **saison_team_document(
                    "2026", TEAM_OID, "Muster", "MUX", kontakte=block, bestaetigungen={"stellvertretung": None, **bestaetigungen}
                ),
            }
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Muster", "MUX"))
            await database[Collection.SAISON_TEAMS].insert_one(row)
            async with client.start_session() as session:
                for position, (seats, _) in enumerate(owed):
                    mail, _ = owed_kontakt_link(
                        row=row, saison_id="2026", kontakte=block, seats=seats, frist=TODAY, zeile="offen", schluessel=f"case/{position}"
                    )
                    await enqueue_mails(postausgang_collection=database[Collection.POSTAUSGANG], session=session, mails=[mail], now=MAIL_NOW)
            mails = await drained(database, client)
            # Oldest first, which is the order they were owed in.
            assert len(mails) == len(owed)
            for mail, (_, event) in zip(mails, owed, strict=True):
                if event is not None:
                    ereignis = FLPostausgangEreignisPayload(id=mail.id, stand=event, grund=None, am=MAIL_NOW)
                    await post_ereignis(ereignis_data=ereignis, postausgang_collection=database[Collection.POSTAUSGANG])
            roh = await aggregate_many_from_db(collection=database[Collection.TEAMS], pipeline=build_team_saisons_pipeline())
            return roh, await get_team_saisons(
                teams_collection=database[Collection.TEAMS],
                adresswechsel_collection=database[Collection.ADRESSWECHSEL],
                today=TODAY,
                berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
                postausgang_collection=database[Collection.POSTAUSGANG],
                operator=ADMINISTRATORS[0],
                auth_time=int(time.time()),
            )

    roh, response = on_the_seed_loop(run())
    [membership] = response.teams[0].memberships

    return roh, membership.model_dump(mode="json")["bestaetigungen"]


def link(name: str, **fields: Any) -> dict[str, Any]:
    """A seat's link as its write and its mail's hand-out leave it."""

    return {**compose_kontakt_bestaetigung(today=TODAY), "token_hashes": [hash_token(name)], **fields}


@pytest.mark.db
def test_each_seats_link_is_served_by_its_state_and_never_by_its_hash(mongo_replica_set_url: str):
    """The contacts editor shows each seat's link as the referee editor shows the referee's: sent, due and what became of its mail."""

    roh, served = read_the_links(
        mongo_replica_set_url,
        {"trainer": link("trainer-link"), "ansprechperson": link("ansprechperson-link")},
        owed=[(("trainer",), "unzustellbar"), (("ansprechperson",), None)],
    )

    trainer = served["trainer"]
    assert {key: value for key, value in trainer.items() if key != "zustellung"} == {
        "verschickt_am": TODAY,
        "frist": link("trainer-link")["frist"],
        "abgelehnt_am": None,
        "abgelaufen": False,
    }
    assert (trainer["zustellung"]["stand"], trainer["zustellung"]["zustellung"]["stand"], trainer["zustellung"]["unzustellbar"]) == (
        "gesendet",
        "unzustellbar",
        True,
    )
    assert served["ansprechperson"]["zustellung"] == {"stand": "gesendet", "zustellung": None, "unzustellbar": False}
    assert served["stellvertretung"] is None
    # Twice: the read drops the hashes, and the model declares none, so neither alone carries them to the wire.
    assert "token_hash" not in json.dumps(roh, default=str)
    assert "token_hash" not in json.dumps(served)


@pytest.mark.db
def test_a_trainer_one_link_holds_beside_a_second_seat_reads_that_links_mail(mongo_replica_set_url: str):
    """The mail is owed about the seat the Trainer mirrors, and the Trainer's seat reads it while one link holds both."""

    paired = kontaktperson_document("Anke")
    shared = link("one-link-for-both")
    _, served = read_the_links(
        mongo_replica_set_url,
        {"trainer": shared, "ansprechperson": link("bert-link"), "stellvertretung": shared},
        kontakte={"stellvertretung": paired, "trainer_ist_zugleich": "stellvertretung"},
        owed=[(("stellvertretung", "trainer"), "beschwerde"), (("ansprechperson",), None)],
    )

    assert [(served[seat]["zustellung"] or {}).get("zustellung") is not None for seat in ("trainer", "stellvertretung", "ansprechperson")] == [
        True,
        True,
        False,
    ]


@pytest.mark.db
def test_a_link_no_mail_was_owed_for_reads_as_none(mongo_replica_set_url: str):
    _, served = read_the_links(mongo_replica_set_url, {"trainer": link("seeded"), "ansprechperson": None})

    assert served["trainer"]["zustellung"] is None


@pytest.mark.db
def test_a_link_reads_as_lapsed_exactly_where_its_press_refuses(mongo_replica_set_url: str):
    """Its deadline's own day still answers, the day after does not: the read and the press judge one rule at one date."""

    _, served = read_the_links(
        mongo_replica_set_url, {"trainer": link("due-today", frist=TODAY), "ansprechperson": link("due-yesterday", frist="2026-02-28")}
    )
    seats = [served["trainer"], served["ansprechperson"]]

    assert [seat["abgelaufen"] for seat in seats] == [False, True]
    assert [find_saison_frist_refusal(frist=seat["frist"], today=TODAY) is not None for seat in seats] == [False, True]


@pytest.mark.db
def test_an_answered_seat_reads_as_lapsed_never_once_its_deadline_passes(mongo_replica_set_url: str):
    """A confirmed seat and one its person declined have nothing left to collect, so their passed deadlines cost nothing."""

    _, served = read_the_links(
        mongo_replica_set_url,
        {
            "trainer": link("confirmed", frist="2026-02-28"),
            "ansprechperson": link("declined", frist="2026-02-28", abgelehnt_am="2026-02-10"),
            "stellvertretung": link("open", frist="2026-02-28"),
        },
        kontakte={
            "trainer": kontaktperson_document("Anke", bestaetigt_am="2026-02-05"),
            "ansprechperson": None,
            "stellvertretung": kontaktperson_document("Cora"),
        },
    )

    assert [served[seat]["abgelaufen"] for seat in ("trainer", "ansprechperson", "stellvertretung")] == [False, False, True]

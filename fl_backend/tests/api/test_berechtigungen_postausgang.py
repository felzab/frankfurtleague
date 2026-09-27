"""
API · one outbox row as it is composed, apart from any database

`app/api/berechtigungen/services.py :: compose_postausgang` writes what a later stamp copies into the
log, so a barred address it lets through is kept in plain for the log's twelve months.
"""

from datetime import UTC, datetime

from bson import ObjectId

from app.api.berechtigungen.schemas import FLBerechtigungStand
from app.api.berechtigungen.services import compose_postausgang

GRANT = ObjectId("6890a1b2c3d4e5f607920011")
NOW = datetime(2026, 4, 1, 10, 30, tzinfo=UTC)
ANNA = "anna.admin@frankfurtleague.de"
NEU = FLBerechtigungStand(adresse="nora.neu@beispielschule.de", verwaltung="administration")


def test_an_acting_administrator_barred_when_queued_is_stored_withheld_and_still_the_applications():
    """The actor is stored folded, the spelling a barred set holds; withheld, `urheber` alone says who made the change."""

    row = compose_postausgang(
        berechtigung_id=GRANT, art="erteilt", jetzt=NEU, vorher=None, geaendert_von="Anna.Admin@Frankfurtleague.de", now=NOW, gesperrt={ANNA}
    )

    assert (row["geaendert_von"], row["urheber"], row["vorenthalten"], row["geaendert_am"]) == (None, "anwendung", "gesperrt", NOW)


def test_an_unbarred_actor_is_stored_folded_with_no_reason():
    """The control for the case above: nothing barred, nothing withheld."""

    row = compose_postausgang(
        berechtigung_id=GRANT, art="erteilt", jetzt=NEU, vorher=None, geaendert_von="Anna.Admin@Frankfurtleague.de", now=NOW, gesperrt=()
    )

    assert (row["geaendert_von"], row["urheber"], row["vorenthalten"]) == (ANNA, "anwendung", None)


def test_a_change_found_in_the_database_names_its_source_rather_than_leaving_a_null_actor_to_say_it():
    row = compose_postausgang(berechtigung_id=GRANT, art="erteilt", jetzt=NEU, vorher=None, geaendert_von=None, now=NOW, gesperrt=())

    assert (row["geaendert_von"], row["geaendert_am"], row["urheber"], row["vorenthalten"]) == (None, None, "datenbank", None)


def test_a_barred_grant_address_is_withheld_with_the_same_reason():
    row = compose_postausgang(
        berechtigung_id=GRANT, art="entzogen", jetzt=None, vorher=NEU, geaendert_von=None, now=NOW, gesperrt={"nora.neu@beispielschule.de"}
    )

    assert (row["vorher"], row["vorenthalten"]) == ({"adresse": None, "verwaltung": "administration"}, "gesperrt")

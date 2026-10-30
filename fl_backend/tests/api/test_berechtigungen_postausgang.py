"""
API · one grant notice's facts as they are composed, apart from any database

`app/api/berechtigungen/services.py :: compose_mitteilung` writes what every administrator is mailed, so a barred
address it lets through reaches each of them in plain.
"""

from datetime import UTC, datetime

from bson import ObjectId

from app.api.berechtigungen.schemas import FLGrantStand
from app.api.berechtigungen.services import compose_mitteilung

GRANT = ObjectId("6890a1b2c3d4e5f607920011")
NOW = datetime(2026, 4, 1, 10, 30, tzinfo=UTC)
ANNA = "anna.admin@frankfurtleague.de"
NEU = FLGrantStand(adresse="nora.neu@beispielschule.de", verwaltung="administration")


def test_an_acting_administrator_barred_when_queued_is_stored_withheld_and_still_the_applications():
    """The actor is stored folded, the spelling a barred set holds; withheld, `author` alone says who made the change.

    No reason is stored: it is the grant address's, and the grant's address here is nobody's ban.
    """

    row = compose_mitteilung(
        grant_id=GRANT, art="granted", jetzt=NEU, before=None, changed_by="Anna.Admin@Frankfurtleague.de", now=NOW, barred={ANNA}
    ).data

    assert (row["changed_by"], row["author"], row["withheld"], row["changed_at"]) == (None, "anwendung", None, NOW)
    assert row["now"] == NEU.model_dump()


def test_an_unbarred_actor_is_stored_folded_with_no_reason():
    """The control for the case above: nothing barred, nothing withheld."""

    row = compose_mitteilung(
        grant_id=GRANT, art="granted", jetzt=NEU, before=None, changed_by="Anna.Admin@Frankfurtleague.de", now=NOW, barred=()
    ).data

    assert (row["changed_by"], row["author"], row["withheld"]) == (ANNA, "anwendung", None)


def test_a_change_found_in_the_database_names_its_source_rather_than_leaving_a_null_actor_to_say_it():
    row = compose_mitteilung(grant_id=GRANT, art="granted", jetzt=NEU, before=None, changed_by=None, now=NOW, barred=()).data

    assert (row["changed_by"], row["changed_at"], row["author"], row["withheld"]) == (None, None, "datenbank", None)


def test_a_barred_grant_address_is_withheld_with_the_same_reason():
    row = compose_mitteilung(
        grant_id=GRANT, art="revoked", jetzt=None, before=NEU, changed_by=None, now=NOW, barred={"nora.neu@beispielschule.de"}
    ).data

    assert (row["before"], row["withheld"]) == ({"adresse": None, "verwaltung": "administration"}, "barred")

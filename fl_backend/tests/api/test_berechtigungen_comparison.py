"""
API · the reconciliation's comparison, apart from any database

`app/api/berechtigungen/services.py :: compare` decides what counts as a change, so what it answers
is what every administrator is told.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId

from app.api.berechtigungen.services import berechtigt_seit, compare, gefunden

FIRST = ObjectId("6890a1b2c3d4e5f607920001")
SECOND = ObjectId("6890a1b2c3d4e5f607920002")

# As the driver reads a stored instant back: naive, and UTC.
TYPED = datetime(2026, 1, 1, 9, 0)
FOUND = datetime(2026, 4, 1, 10, 30)


def row(grant_id: ObjectId, adresse: str, verwaltung: str = "administration") -> dict[str, Any]:
    return {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung}


def kinds(grants: list[dict[str, Any]], announced: list[dict[str, Any]]) -> list[tuple[ObjectId, str]]:
    return [(grant_id, art) for grant_id, art, _, _ in compare(grants=grants, announced=announced)]


def test_an_unchanged_list_has_nothing_to_announce():
    """The control: a comparison reporting every grant as new passes each case below."""

    same = [row(FIRST, "anna@schule.de")]

    assert kinds(same, same) == []


def test_a_revoke_and_a_regrant_of_one_address_are_two_changes():
    """Compared by address, the two would cancel and nobody would hear of either."""

    assert kinds([row(SECOND, "anna@schule.de")], [row(FIRST, "anna@schule.de")]) == [(FIRST, "entzogen"), (SECOND, "erteilt")]


def test_a_tier_changed_in_place_is_one_change():
    assert kinds([row(FIRST, "anna@schule.de", "owner")], [row(FIRST, "anna@schule.de")]) == [(FIRST, "geaendert")]


def test_an_address_repointed_under_one_id_is_the_old_ones_removal_and_the_new_ones_grant():
    """Read as one tier change, the notice would name the new address alone and hide whose access ended."""

    changes = compare(grants=[row(FIRST, "berta@schule.de", "owner")], announced=[row(FIRST, "anna@schule.de")])

    assert [
        (art, jetzt and (jetzt.adresse, jetzt.verwaltung), vorher and (vorher.adresse, vorher.verwaltung)) for _, art, jetzt, vorher in changes
    ] == [("entzogen", None, ("anna@schule.de", "administration")), ("erteilt", ("berta@schule.de", "owner"), None)]


def test_each_change_carries_both_states_the_stamp_is_handed_back():
    [(_, _, jetzt, vorher)] = compare(grants=[row(FIRST, "anna@schule.de", "owner")], announced=[row(FIRST, "anna@schule.de")])

    assert (jetzt and jetzt.verwaltung, vorher and vorher.verwaltung) == ("owner", "administration")


def test_a_grant_found_new_is_one_the_comparison_stamps_and_a_tier_change_is_not():
    """A repointed address is a new grant to its new holder, whose sessions before it must not administer (`docs/backend/spec.md :: I525`)."""

    changes = compare(
        grants=[row(FIRST, "berta@schule.de"), row(SECOND, "carla@schule.de", "owner")],
        announced=[row(FIRST, "anna@schule.de"), row(SECOND, "carla@schule.de")],
    )

    assert gefunden(changes) == [FIRST]


class TestWhenAGrantTookEffect:
    """The one reading the subject lookup and the actor check share, so neither judges a session against another instant."""

    def test_the_comparison_s_stamp_outranks_the_row_s_own_date(self):
        """A paste's `erteilt_am` is whatever was typed, and a repoint keeps the address before's."""

        assert berechtigt_seit({"erteilt_am": TYPED, "gefunden_am": FOUND}) == FOUND.replace(tzinfo=UTC)

    @pytest.mark.parametrize("stored", [pytest.param({}, id="no stamp"), pytest.param({"gefunden_am": None}, id="a null stamp")])
    def test_a_row_nothing_found_is_dated_by_its_own_erteilt_am(self, stored: dict[str, Any]):
        """A grant made here, and a paste no pass has reached yet: dated otherwise, the first owner could sign in to nothing until one ran."""

        assert berechtigt_seit({"erteilt_am": TYPED, **stored}) == TYPED.replace(tzinfo=UTC)

    def test_the_instant_is_the_utc_one_the_driver_read_back_without_an_offset(self):
        """Compared against an epoch second, a naive instant taken for local time would move every grant by the host's offset."""

        assert berechtigt_seit({"erteilt_am": TYPED}).utcoffset() == timedelta(0)

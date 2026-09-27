"""
API · the reconciliation's comparison, apart from any database

`app/api/berechtigungen/services.py :: compare` decides what counts as a change, so what it answers
is what every administrator is told.
"""

from typing import Any

from bson import ObjectId

from app.api.berechtigungen.services import compare

FIRST = ObjectId("6890a1b2c3d4e5f607920001")
SECOND = ObjectId("6890a1b2c3d4e5f607920002")


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

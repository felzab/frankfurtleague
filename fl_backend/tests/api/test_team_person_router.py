"""
API · the seats a team's Übersicht lists, one entry per person, pinned on fabricated seat blocks

The league's own team editor lists a Trainer holding a second seat once; so does the team's own page.
"""

from app.api.teams.person_router import _seats_of
from tests.documents import kontakte_document, kontaktperson_document

THEO = kontaktperson_document("Theo")
ANNA = kontaktperson_document("Anna")


def test_a_trainer_holding_a_second_seat_is_one_entry_naming_both():
    """Listed per seat, the same person stood twice, where the league's own team editor lists them once.

    The third seat held, so its entry names its own seat alone rather than the Trainer's second too.
    """

    seats = _seats_of(kontakte_document(trainer=THEO, ansprechperson=THEO, stellvertretung=ANNA, trainer_is_also="ansprechperson"))

    assert [(seat.rollen, seat.name) for seat in seats] == [
        (["trainer", "ansprechperson"], "Theo Theo-Mustermann"),
        (["stellvertretung"], "Anna Anna-Mustermann"),
    ]


def test_an_emptied_trainers_second_seat_is_listed_as_its_own():
    """An erased Trainer names nobody whose second seat it could be, so the seat beside it keeps its own entry."""

    seats = _seats_of(kontakte_document(trainer=None, ansprechperson=ANNA, trainer_is_also="ansprechperson"))

    assert [(seat.rollen, seat.name) for seat in seats] == [
        (["trainer"], None),
        (["ansprechperson"], "Anna Anna-Mustermann"),
        (["stellvertretung"], None),
    ]

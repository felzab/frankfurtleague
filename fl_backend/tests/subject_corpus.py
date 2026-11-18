"""
TESTS · the addresses the subject lookup answers, each held on a seat, a pupil row and a referee row

One mailbox in all three collections twice over, a bystander beside each, the refused spellings, a mailbox whose
records are all unconfirmed and one whose rows are all retired. Each suite seeds it on a database of its own.
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests.documents import (
    confirmed_referee_document,
    kontaktperson_document,
    saison_team_document,
    school_year_saison_document,
    spieler_document,
    team_document,
)

# The folded form every record stores the address in. Deliberately unusual, so a hit in a seeded corpus cannot be a
# coincidence.
IDENTIFIER = "ortrud.zwiebelmayer@schule.example.org"

# Nobody this identifier may reach, in each of the three collections.
BYSTANDER = "baldur.krautzberger@example.com"

# A mailbox whose every record awaits its own person's confirmation, and one whose every record is
# confirmed on a row that has since been retired.
UNCONFIRMED = "ottilie.wartezeit@schule.example.org"
RETIRED = "rudolf.ruhestand@schule.example.org"

# A banned address holding a confirmed seat, the seat stored folded.
BARRED_STORED = "gerda.gesperrt@schule.example.org"

# The grants, stored folded as every grant is.
ADMIN_OWNER = "inhaberin@frankfurtleague.de"
ADMIN_STORED = "verena.verwaltung@schule.example.org"
GRANT_OWNER_OID = ObjectId("6890a1b2c3d4e5f607820051")
GRANT_STORED_OID = ObjectId("6890a1b2c3d4e5f607820052")

# One mailbox at an internationalised domain, stored as every payload stores it:
# the domain in punycode.
IDN_STORED = "anna@xn--mller-kva.example.org"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

# Fixed rather than generated, so a failure names the same row every run. Ordered so the answer's
# own sort is asserted rather than reproduced: A before B before C.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607820001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607820002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607820003")
SEAT_ROW_A_OID = ObjectId("6890a1b2c3d4e5f607820011")
SEAT_ROW_B_OID = ObjectId("6890a1b2c3d4e5f607820012")
BYSTANDER_ROW_OID = ObjectId("6890a1b2c3d4e5f607820013")
IDN_ROW_OID = ObjectId("6890a1b2c3d4e5f607820017")
PUPIL_ONE_OID = ObjectId("6890a1b2c3d4e5f607820021")
IDN_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820023")
BYSTANDER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820029")
REFEREE_ONE_OID = ObjectId("6890a1b2c3d4e5f607820031")
REFEREE_TWO_OID = ObjectId("6890a1b2c3d4e5f607820032")
IDN_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820034")
UNCONFIRMED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820035")
RETIRED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820036")
BYSTANDER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820039")

# The name the junction row was entered under, and the one the club has taken since. They differ so
# that serving the club's own would be observable.
ROW_NAME_A = "Helmholtz"
TEAM_NAME_A_NOW = "Helmholtz-Gymnasium"
ROW_NAME_B = "Lessing"

STAMP = "2026-01-20"


def _person(email: str, *, confirmed_at: str | None = STAMP) -> dict[str, Any]:
    """Every field `app/api/teams/schemas.py :: FLKontaktperson` requires, the address and the stamp the only ones a case reads.

    Stamped by default: the lookup answers a seat only once its own person has confirmed it.
    """

    return kontaktperson_document("Anna", confirmed_at=confirmed_at, last_name="Müller", email=email, phone="+49 69 90009101")


def _junction(row_id: ObjectId, saison_id: str, team_id: ObjectId, *, name: str, **slots: str | dict[str, Any]) -> dict[str, Any]:
    """A `saison_teams` row seating whoever the caller names, an address as a confirmed seat, the slots it does not name left empty."""

    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:3].upper(),
        _id=row_id,
        kontakte={
            **{slot: None for slot in KONTAKT_ROLLEN},
            **{slot: _person(seat) if isinstance(seat, str) else seat for slot, seat in slots.items()},
            # A declaration about two slots rather than a slot of its own, so it names nobody and
            # no case here turns on it (`app/api/teams/schemas.py :: KONTAKT_ROLLEN`).
            "trainer_is_also": None,
        },
    )


def _team(team_id: ObjectId, name: str, shorthand: str) -> dict[str, Any]:
    # `shorthand` per club rather than one for all: `app/core/constraints.py :: uniq_shorthand`
    # indexes it, so a seed sharing one refuses its second club and fails every case here.
    return team_document(team_id, name, shorthand, website_url=None)


def _pupil(pupil_id: ObjectId, email: str) -> dict[str, Any]:
    """`email` stored in the folded form, which is what S6's admission writes and what the join compares."""

    return spieler_document(pupil_id, "Anna", "Müller", email=email)


async def the_subjects_corpus(database: AsyncDatabase) -> None:
    """One corpus for every case: the mailbox in all three collections twice over, a bystander beside each, and the refused spellings.

    Beside them, one mailbox whose records are all unconfirmed and one whose rows are all retired.
    """

    await database[Collection.SAISONS].insert_many(
        [
            school_year_saison_document(PAST_SAISON, "past"),
            school_year_saison_document(ACTIVE_SAISON, "active"),
            school_year_saison_document(FUTURE_SAISON, "future"),
        ]
    )
    await database[Collection.TEAMS].insert_many(
        [_team(TEAM_A_OID, TEAM_NAME_A_NOW, "HEX"), _team(TEAM_B_OID, ROW_NAME_B, "LEX"), _team(TEAM_C_OID, "Krautzberg", "KRX")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(SEAT_ROW_A_OID, PAST_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=IDENTIFIER),
            # One address in TWO person slots of one row, which is what a person entered twice is.
            _junction(SEAT_ROW_B_OID, ACTIVE_SAISON, TEAM_B_OID, name=ROW_NAME_B, trainer=IDENTIFIER, ansprechperson=IDENTIFIER),
            _junction(
                BYSTANDER_ROW_OID,
                ACTIVE_SAISON,
                TEAM_C_OID,
                name="Krautzberg",
                trainer=BYSTANDER,
                ansprechperson=_person(UNCONFIRMED, confirmed_at=None),
                stellvertretung=BARRED_STORED,
            ),
            _junction(IDN_ROW_OID, PAST_SAISON, TEAM_C_OID, name="Krautzberg", trainer=IDN_STORED),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(PUPIL_ONE_OID, IDENTIFIER),
            _pupil(IDN_PUPIL_OID, IDN_STORED),
            _pupil(BYSTANDER_PUPIL_OID, BYSTANDER),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            confirmed_referee_document(REFEREE_ONE_OID, IDENTIFIER, "A. Referee", confirmed_at=STAMP),
            confirmed_referee_document(REFEREE_TWO_OID, IDENTIFIER, "C. Zweitpfeife", confirmed_at=STAMP),
            confirmed_referee_document(IDN_REFEREE_OID, IDN_STORED, "E. Umlaut", confirmed_at=STAMP),
            confirmed_referee_document(BYSTANDER_REFEREE_OID, BYSTANDER, "B. Krautzberger", confirmed_at=STAMP),
            confirmed_referee_document(UNCONFIRMED_REFEREE_OID, UNCONFIRMED, "F. Wartezeit", einwilligung=None, confirmed_at=STAMP),
            confirmed_referee_document(RETIRED_REFEREE_OID, RETIRED, "G. Ruhestand", inactive_since="2026-03-01", confirmed_at=STAMP),
        ]
    )
    await database[Collection.GRANTS].insert_many(
        [_grant(GRANT_OWNER_OID, ADMIN_OWNER, "owner"), _grant(GRANT_STORED_OID, ADMIN_STORED, "administration")]
    )


GRANT_TYPED = datetime(2026, 1, 1, tzinfo=UTC)


def _grant(grant_id: ObjectId, address: str, admin_tier: str) -> dict[str, Any]:
    """A grant as a hand-written one or the grant route stores it: the folded identifier and its tier."""

    return {"_id": grant_id, "address": address, "admin_tier": admin_tier, "effective_from": GRANT_TYPED}

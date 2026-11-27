from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, get_args

from app.api.bewerbungen.services import (
    claimed_pair_seat,
    compose_einwilligung,
    confirmation_deadline_from,
    person_of,
    row_takes_confirmations,
    seat_is_answered,
)
from app.api.outbox.schemas import FLKontaktLinkData, FLOutboxLink, FLOutboxReference, FLOutboxStatus
from app.api.outbox.services import OwedMail
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import (
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLSpielCommon,
)
from app.api.teams.schemas import FLKontaktMint, FLTeamGruppeOffer, FLTeamListState, FLTeamMembership, FLTeamsAdminRow, FLTeamStatistik
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.einwilligung import seat_is_confirmed
from app.shared.folding import normalise_phone, person_name_key, sign_in_identifier
from app.shared.links import deadline_passed
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import KONTAKT_SEATS, FLGruppenNames, FLKontaktRow, FLKontaktSeat, FLTrikotFarbe

AS_NAME = "saison_data"
SAISON_PAST_AS_NAME = "saison_past_data"

# Derived from the model, so a field added to `FLTeamStatistik` cannot be forgotten here.
ZERO_STATISTIK: Mapping[str, int] = {field_name: 0 for field_name in FLTeamStatistik.model_fields}


def counting_spiele_match() -> dict[str, Any]:
    """Whether a fixture counts. A forfeit does, and a shoot-out is a draw."""

    return {
        "ergebnis": {"$ne": None},
        # Both counts as well, as `counted_goals` asks them, so a count of played fixtures agrees with the table's.
        "team1.tore": {"$ne": None},
        "team2.tore": {"$ne": None},
    }


def build_retirement_stages(saison_id: str) -> list[Mapping[str, Any]]:
    """A club that left the league keeps its place in a `past` season and in no other."""

    return [
        {
            "$lookup": {
                "from": Collection.SAISONS,
                # `status`, never `end_date`: activating the next season closes this one before its
                # last day, and a club retiring in between played it all the same.
                "pipeline": [{"$match": {"_id": saison_id, "status": "past"}}, {"$project": {"_id": 1}}],
                "as": SAISON_PAST_AS_NAME,
            }
        },
        # Not dropped on `retire_blocked`'s strength: that refusal holds writes alone, and no report counts
        # a club already stored retired in a running or planned season, so this match keeps one off the reads.
        {"$match": {"$or": [{"inactive_since": None}, {f"{SAISON_PAST_AS_NAME}.0": {"$exists": True}}]}},
    ]


def build_team_pipeline(
    *,
    saison_id: str,
    team_id: Any | None = None,
    # Retired clubs, for a read handed one club's id rather than discovering one. Never on a base-tier list: a standings
    # row names no leaving date, so a list that un-hid a retired club would say nothing about which one had left.
    include_inactive: bool = False,
) -> list[Mapping[str, Any]]:
    pipeline: list[Mapping[str, Any]] = []

    if team_id is not None:
        pipeline.append({"$match": {"_id": team_id}})

    # Clubs that left the league -- never a team that left one season, which keeps its row.
    if not include_inactive:
        pipeline.extend(build_retirement_stages(saison_id))

    lookup_pipeline: list[Mapping[str, Any]] = [
        {"$match": {"$expr": {"$eq": ["$team_id", "$$base_team_id"]}}},
        {"$match": {"saison_id": saison_id}},
    ]

    # Withheld at the join rather than downstream: the outer `$project` is an allow-list too, so this
    # is defence in depth -- two of this pipeline's callers are base-tier and the row carries contact records.
    lookup_pipeline.append({"$project": {"_id": 0, "gruppe": 1, "austritt": 1, "name": 1, "shorthand": 1}})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "let": {"base_team_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # Strict: a club with no row of the season drops out, where a lenient join would return one row
    # per season it played and a table of zeros that reads as an answer.
    pipeline.append({"$unwind": f"${AS_NAME}"})

    # No figures: a caller wanting a table counts them with `build_statistik_by_team` over the fixtures it reads.
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                # From the junction, not the club: this read is season-scoped, and a finished season
                # is the record of the name it was played under rather than of today's.
                "name": f"${AS_NAME}.name",
                "shorthand": f"${AS_NAME}.shorthand",
                "address": 1,
                "description": 1,
                "full_name": 1,
                "schulform": 1,
                "website_url": 1,
                "inactive_since": 1,
                "gruppe": f"${AS_NAME}.gruppe",
                "austritt": f"${AS_NAME}.austritt",
            }
        }
    )

    pipeline.append({"$sort": {"name": 1}})

    return pipeline


def counted_goals(spiel: FLSpielCommon) -> tuple[CustomObjectId, int, CustomObjectId, int] | None:
    """Whether a fixture counts, as `counting_spiele_match` asks it of the collection: its two sides and their goals, else `None`."""

    if spiel.ergebnis is None or spiel.team1 is None or spiel.team2 is None:
        return None
    if spiel.team1.tore is None or spiel.team2.tore is None:
        return None

    return spiel.team1.team_id, spiel.team1.tore, spiel.team2.team_id, spiel.team2.tore


def build_statistik_by_team(spiele: Iterable[FLSpielCommon], rules: FLSaisonRules) -> Mapping[CustomObjectId, FLTeamStatistik]:
    """Every team's figures over the fixtures given, the one count the Tabelle and the bracket share.

    It filters nothing: pass the season's group phase alone, since a knockout result is no league result.
    """

    figures: dict[CustomObjectId, dict[str, int]] = {}

    for spiel in spiele:
        # Distinct, so a fixture holding one club twice, a fault state, counts once for it.
        sides = {side.team_id for side in (spiel.team1, spiel.team2) if side is not None}
        for team_id in sides:
            figures.setdefault(team_id, dict(ZERO_STATISTIK))

        if spiel.sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT:
            for team_id in sides:
                figures[team_id]["count_cancelled_spiele"] += 1

        counted = counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, _, tore2 = counted
        for team_id in sides:
            # Slot one first, so the fixture holding one club twice is oriented one way.
            tore_self, tore_opponent = (tore1, tore2) if team_id == team1_id else (tore2, tore1)

            row = figures[team_id]
            row["count_played_spiele"] += 1
            row["tore_scored"] += tore_self
            row["tore_conceded"] += tore_opponent

            if tore_self > tore_opponent:
                row["siege"] += 1
                row["punkte"] += rules.win_points
            elif tore_self == tore_opponent:
                row["unentschieden"] += 1
                row["punkte"] += rules.draw_points
            else:
                row["niederlagen"] += 1
                row["punkte"] += rules.loss_points

    return {team_id: FLTeamStatistik.model_validate(row) for team_id, row in figures.items()}


def build_membership_pipeline(*, saison_id: str, team_id: Any) -> list[Mapping[str, Any]]:
    """One club's row of one season as its editor reads it: the membership's fields and the row's id, which its links' mails are owed about.

    Read off `FLTeamMembership`, so a field added to the model reaches the read, and an allow-list, so a field added to the
    row alone does not.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id}},
        {"$project": dict.fromkeys(["_id", *FLTeamMembership.model_fields], 1)},
        # Each link's state and never its hash, which only the link's own lookup reads. Unset rather than projected field
        # by field: a sub-path projection drops a null seat's key.
        {"$unset": [f"confirmations.{seat}.token_hashes" for seat in KONTAKT_SEATS]},
    ]


def _seat_state(row: Mapping[str, Any], seat: str) -> str:
    """The seat the mail carrying this seat's link was owed about: the one a Trainer mirrors, where one link holds both.

    One link holds both exactly where the two entries are one: the write minting it stores the same entry under each,
    and its hand-out writes the same hash into both.
    """

    also = (row.get("kontakte") or {}).get("trainer_is_also")
    links = row.get("confirmations") or {}
    if seat == "trainer" and also in KONTAKT_SEATS and links.get(also) == links.get("trainer"):
        return str(also)

    return seat


def with_link_state(row: Mapping[str, Any], *, today: str, states: Mapping[tuple[Any, str | None], FLOutboxStatus]) -> dict[str, Any]:
    """The membership read with each stored seat link judged as its press judges it, and what became of its mail.

    Lapsed only on an unanswered seat: an answered seat's link has nothing left to collect.
    """

    confirmations: Mapping[str, Any] | None = row.get("confirmations")
    if confirmations is None:
        return dict(row)

    def expired(seat: str, link: Mapping[str, Any]) -> bool:
        open = not seat_is_answered(kontakte=row.get("kontakte"), confirmations=confirmations, seat=seat)
        return open and deadline_passed(deadline=link.get("deadline"), today=today)

    return {
        **row,
        "confirmations": {
            seat: {**link, "expired": expired(seat, link), "delivery": states.get((row["_id"], _seat_state(row, seat)))}
            if link is not None
            else None
            for seat, link in confirmations.items()
        },
    }


def as_unconfirmed(einwilligung: Mapping[str, Any]) -> dict[str, Any]:
    """A seat's record held unconfirmed, as it stands until its person answers.

    The stamp nulled: a blank stamp is no answer.
    """

    return {**einwilligung, "confirmed_at": None}


# Which fields say who holds a seat. The telephone number is not one: it is a way to reach a person
# rather than a claim about which person sits there.
SEAT_IDENTITY_FIELDS: tuple[str, ...] = ("email", "first_name", "last_name")


def _identity_of(person: Mapping[str, Any]) -> tuple[str, ...]:
    """Who a seat's stored person is, folded so two spellings of one person compare equal."""

    # The address as sign-in folds it, so a stamp never crosses to another inbox, and re-typing „ida“
    # as „Ida“ still costs nobody a fresh confirmation.
    return tuple(
        sign_in_identifier(str(person.get(field) or "")) if field == "email" else person_name_key(person.get(field))
        for field in SEAT_IDENTITY_FIELDS
    )


def _seat_held_by(stored_person: Mapping[str, Any] | None, *, person: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The stored seat where it holds the same person as the one being written, else `None`."""

    if stored_person is None:
        return None

    # A difference the fold keeps is a handover even where it is a corrected typo: nothing here can
    # tell the two apart, and only this direction refuses a record saying one person answered for
    # another.
    if _identity_of(stored_person) != _identity_of(person):
        return None

    return stored_person


def _confirmation_held_by(stored_person: Mapping[str, Any] | None, *, person: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The stored record, whole, where this seat holds the same person, else `None`.

    The scope, media answer, label and their evidence are the person's, and the payload spells none
    of them: a record recomposed from it erases them.
    """

    held = _seat_held_by(stored_person, person=person)
    if held is None:
        return None

    # The record stays the server's: only a seat's own stamp
    # confirms it, and a stored blank stamp is none.
    einwilligung = held["einwilligung"]
    return dict(einwilligung) if seat_is_confirmed(held) else as_unconfirmed(einwilligung)


def _birth_date_held_by(stored_person: Mapping[str, Any] | None, *, person: Mapping[str, Any]) -> str | None:
    """The date this person already sits behind in this seat, or `None`."""

    # The identity alone and never the confirmation beside it: a seat can hold a date under no stamp,
    # and nulling one here would destroy it as a side effect of an edit to the telephone number.
    held = _seat_held_by(stored_person, person=person)
    if held is None:
        return None

    # A stored blank is a date every read already answers as none, so writing it back would keep a
    # value no reader can see.
    return str(held.get("birth_date")) if held.get("birth_date") else None


def compose_kontakte_origin(*, kontakte: Mapping[str, Any], stored: Mapping[str, Any] | None) -> dict[str, Any]:
    """Each seat's record and its birthdate, off the stored block.

    A seat its person keeps keeps its record and its date. Any other keeps the record `compose_seat_block` bore it with,
    so nothing of a person who left travels to the one seated.
    """

    stored_block = stored or {}
    composed = dict(kontakte)

    for seat in KONTAKT_SEATS:
        person = kontakte.get(seat)
        if person is None:
            continue

        stored_person = stored_block.get(seat)
        kept = _confirmation_held_by(stored_person, person=person)
        composed[seat] = {
            **person,
            "birth_date": _birth_date_held_by(stored_person, person=person),
            "einwilligung": person["einwilligung"] if kept is None else kept,
        }

    return composed


def compose_seat_block(
    *, stored: Mapping[str, Any] | None, seat: FLKontaktSeat, sent: Mapping[str, Any], today: str
) -> tuple[dict[str, Any], tuple[FLKontaktSeat, ...]]:
    """The whole block a seat write leaves, and the seats it writes, so one person is judged and stored as a block's save judges them.

    Every state of a seat takes the write: a standing person is replaced or corrected, a confirmed one gives way, and an
    emptied seat is filled, a row's seat having no other way back. A claimed pair is one person, so a write on either
    seat reaches both. `sent` holds `trainer_is_also` only where the caller sent it.
    """

    block = dict(stored) if stored is not None else {**dict.fromkeys(KONTAKT_SEATS), "trainer_is_also": None}
    claim = block.get("trainer_is_also")
    if seat == "trainer":
        claim = sent.get("trainer_is_also", claim)

    other = claimed_pair_seat(kontakte={"trainer_is_also": claim}, seat=seat)
    seats = (seat,) if other is None else (seat, other)
    person = {field: value for field, value in sent.items() if field != "trainer_is_also"}
    # The record of a person newly seated; `compose_kontakte_origin` keeps the stored one of a person this write leaves.
    seated = {**person, "einwilligung": compose_einwilligung(today=today)}

    return {**block, **dict.fromkeys(seats, seated), "trainer_is_also": claim}, seats


def find_kontakt_taken_refusal(*, kontakte: Mapping[str, Any], seats: Sequence[FLKontaktSeat]) -> APIError | None:
    """Why this person cannot hold these seats, or `None`: another seat's person holds their address or their number.

    Asked of the seats this write leaves. The seats it writes are one person, so they are never compared with each
    other.
    """

    person = kontakte[seats[0]]
    others = [held for seat in KONTAKT_SEATS if seat not in seats and (held := kontakte.get(seat)) is not None]

    if sign_in_identifier(person["email"]) in {sign_in_identifier(str(held.get("email") or "")) for held in others}:
        return APIError(HTTPStatus.CONFLICT, Code.KONTAKT_EMAIL_TAKEN, fields=(("email",),))

    if normalise_phone(person["phone"]) in {normalise_phone(str(held.get("phone") or "")) for held in others}:
        return APIError(HTTPStatus.CONFLICT, Code.KONTAKT_PHONE_TAKEN, fields=(("phone",),))

    return None


def compose_kontakt_confirmation(*, today: str) -> dict[str, Any]:
    """One seat's fresh link: mailed today, its deadline the application's bound, nobody declined.

    No link yet: the hand-out of the mail the same write owes mints it into `token_hashes`, so the link the seat held
    before opens nothing from this write on. Written whole wherever a link is owed.
    """

    return {"token_hashes": [], "sent_at": today, "deadline": confirmation_deadline_from(today=today), "declined_at": None}


def people_of(kontakte: Mapping[str, Any] | None) -> list[tuple[FLKontaktSeat, ...]]:
    """Each person the block seats, as the filled seats they hold, the Trainer beside the seat `trainer_is_also` names.

    One link per person: two would leave the first answering for a seat the second already answered.
    """

    block = kontakte or {}
    also = block.get("trainer_is_also")
    people: list[tuple[FLKontaktSeat, ...]] = []

    for seat in KONTAKT_SEATS:
        if seat == also:
            continue

        held: tuple[FLKontaktSeat, ...] = (seat, also) if seat == "trainer" and also in KONTAKT_SEATS else (seat,)
        filled: tuple[FLKontaktSeat, ...] = tuple(seat for seat in held if block.get(seat) is not None)
        if filled:
            people.append(filled)

    return people


def links_owed(*, kontakte: Mapping[str, Any], stored: Mapping[str, Any] | None) -> list[tuple[FLKontaktSeat, ...]]:
    """Each person this save newly seats, as the unconfirmed seats one fresh link answers for.

    Newly is `_seat_held_by`'s identity, so a corrected name is a handover here too: the seat's last
    link reached somebody this save may have just replaced.
    """

    stored_block = stored or {}
    owed: list[tuple[FLKontaktSeat, ...]] = []

    # Each person's seats, one tuple per person `people_of` finds.
    for persons_seats in people_of(kontakte):
        if all(_seat_held_by(stored_block.get(seat), person=kontakte[seat]) is not None for seat in persons_seats):
            continue

        # A seat of the pair this person has already confirmed keeps its stamp and its link.
        unconfirmed: tuple[FLKontaktSeat, ...] = tuple(seat for seat in persons_seats if not seat_is_confirmed(kontakte[seat]))
        if unconfirmed:
            owed.append(unconfirmed)

    return owed


def compose_confirmations_with(*, stored_confirmations: Mapping[str, Any] | None, minted: Mapping[str, Any]) -> dict[str, Any]:
    """The whole link block a write leaves: each link minted, and every other seat's as stored.

    Whole rather than dotted: a `$set` into an absent or null block leaves it short of its keys, or is
    `PathNotViable`. A person a write newly seats stands unconfirmed, so `links_owed` mints their link and
    no seat keeps the link of the person who left it; an empty seat keeps a Widerspruch's record of itself.
    """

    stored_links = stored_confirmations or {}

    return {seat: minted[seat] if seat in minted else stored_links.get(seat) for seat in KONTAKT_SEATS}


def kontakt_reference(saison_team_id: Any, seats: Sequence[FLKontaktSeat]) -> FLOutboxReference:
    """The season row and the person's seat a delivery is read by: the one the Trainer mirrors, where they hold two."""

    return FLOutboxReference(collection=Collection.SAISON_TEAMS, id=saison_team_id, seat=min(seats, key=lambda seat: seat == "trainer"))


def owed_kontakt_link(
    *,
    row: Mapping[str, Any],
    saison_id: str,
    kontakte: Mapping[str, Any],
    seats: Sequence[FLKontaktSeat],
    deadline: str,
    kontakt_row: FLKontaktRow,
    key: str,
) -> tuple[OwedMail, FLKontaktMint]:
    """One person's confirmation link, owed in the write that seats or re-sends it, and the answer naming whom it is owed.

    Every value off the row this transaction read and the block it writes, the seats' person being one. The link
    supersedes every earlier one the seats held, the write having emptied them already; it is minted only while each seat
    still holds the address, so a save moving the seat on before the hand-out drops the mail.
    """

    email = str(kontakte[seats[0]]["email"])

    return (
        OwedMail(
            key=key,
            to=email,
            data=FLKontaktLinkData(
                kind="kontakt_confirmation",
                saison_id=saison_id,
                schule=str(row.get("name") or ""),
                seats=list(seats),
                deadline=deadline,
                row=kontakt_row,
            ),
            reference=kontakt_reference(row["_id"], seats),
            link=FLOutboxLink(
                paths=[f"confirmations.{seat}.token_hashes" for seat in seats],
                addresses=[f"kontakte.{seat}.email" for seat in seats],
                replaced=True,
            ),
        ),
        FLKontaktMint(seats=list(seats), email=email),
    )


def seats_one_link_answers(*, kontakte: Mapping[str, Any], seat: FLKontaktSeat) -> tuple[FLKontaktSeat, ...]:
    """The pressed seat and, where one person holds both, the other seat they have not confirmed."""

    for person in people_of(kontakte):
        if seat in person:
            return tuple(held for held in person if held == seat or not seat_is_confirmed(kontakte[held]))

    return (seat,)


def kontakt_row_of(*, saison_status: Any, austritt: Any) -> FLKontaktRow:
    """The state of the row a link is minted on, as its mail names it."""

    if row_takes_confirmations(saison_status=saison_status, austritt=austritt):
        return "open"

    return "saison_past" if saison_status == "past" else "exited"


def find_kontakt_row_refusal(*, saison_status: Any, austritt: Any) -> APIError | None:
    """`kontakt_row_without_saison`: the row's season has ended, or its team has left it, so a link asks about a seat nobody holds.

    Judged before the seat: no seat repairs the row.
    """

    if row_takes_confirmations(saison_status=saison_status, austritt=austritt):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.KONTAKT_ROW_WITHOUT_SAISON)


def find_kontakt_seat_refusal(*, kontakte: Mapping[str, Any] | None, seat: str) -> APIError | None:
    """Why this seat is sent no fresh link, or `None`: it holds nobody, or its person has confirmed it.

    A fresh link on a confirmed seat would replace a spent one with a credential nothing can answer.
    """

    person = person_of(kontakte, seat)

    if person is None or seat_is_confirmed(person):
        return APIError(HTTPStatus.CONFLICT, Code.KONTAKT_SEAT_WITHOUT_CONFIRMATION)

    return None


def build_team_spiele_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """This club's fixtures of one season. Both sides, because a fixture fields a team on either."""

    return {"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]}


def compose_saison_team(
    *, saison_id: str, team_id: Any, gruppe: FLGruppenNames, trikot_farbe: FLTrikotFarbe | None, name: str, shorthand: str
) -> dict[str, Any]:
    """One club's row of a season as an entry writes it: no departure and no people yet."""

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": gruppe,
        # These two required by `FLTeamMembership`, so a row without one is unreadable.
        "austritt": None,
        "trikot_farbe": trikot_farbe,
        "kontakte": None,
        # Copied rather than joined on read: once the season is `past` this is the name it was played under, which every
        # fixture of it reads.
        "name": name,
        "shorthand": shorthand,
    }


def gruppe_offer(*, rules: FLSaisonRules, gruppen: Iterable[str]) -> list[FLTeamGruppeOffer]:
    """Every group the season offers and whether it is full, by `find_entry_refusal`'s count: a row carrying an `austritt` keeps its place."""

    occupied = Counter(gruppen)
    offered = offered_gruppen(rules.number_of_gruppen)

    return [FLTeamGruppeOffer(gruppe=gruppe, full=occupied[gruppe] >= rules.teams_per_gruppe) for gruppe in offered]


def teams_admin_rows(
    *,
    rows: Sequence[Mapping[str, Any]],
    teams: Sequence[Mapping[str, Any]],
    state: FLTeamListState | None,
    gruppe: FLGruppenNames | None,
) -> list[FLTeamsAdminRow]:
    """The Teams list: the season's rows, or under `retired` the league's retired clubs, each club in no season row with no group.

    A club is retired from the league rather than from a season, so that one filter reads past the season's rows: it is
    the way back to a club no season list holds. `rows` and `teams` arrive sorted by name.
    """

    retired = {team["_id"]: team["inactive_since"] for team in teams if team.get("inactive_since") is not None}
    entered = {row["team_id"]: row for row in rows}

    def listed(row: Mapping[str, Any]) -> FLTeamsAdminRow:
        return FLTeamsAdminRow(
            id=row["team_id"],
            name=row["name"],
            shorthand=row["shorthand"],
            gruppe=row["gruppe"],
            trikot_farbe=row.get("trikot_farbe"),
            austritt_type=(row.get("austritt") or {}).get("type"),
            inactive_since=retired.get(row["team_id"]),
        )

    if state == "retired":
        chosen = [
            listed(entered[team["_id"]])
            if team["_id"] in entered
            else FLTeamsAdminRow(
                id=team["_id"],
                name=team["name"],
                shorthand=team["shorthand"],
                gruppe=None,
                trikot_farbe=None,
                austritt_type=None,
                inactive_since=team["inactive_since"],
            )
            for team in teams
            if team["_id"] in retired
        ]
    else:
        chosen = [listed(row) for row in rows]
        if state == "active":
            chosen = [row for row in chosen if row.austritt_type is None and row.inactive_since is None]
        if state == "departed":
            chosen = [row for row in chosen if row.austritt_type is not None]

    return [row for row in chosen if gruppe is None or row.gruppe == gruppe]


def find_shorthand_refusal(*, taken: bool) -> APIError | None:
    """`duplicate_key` on the shorthand: another club, a retired one included, holds it.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction. The unique index still
    answers a race between two writes, as `duplicate_key` with no field.
    """

    if not taken:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.DUPLICATE_KEY, fields=(("shorthand",),))


def find_team_entry_refusal(*, inactive_since: str | None) -> APIError | None:
    """Why this club may not be entered into any season, or `None`.

    Its own function beside `find_entry_refusal`: a group move re-uses that one, and a club's
    standing in the league is not what a move is about.
    """

    if inactive_since is not None:
        return APIError(HTTPStatus.CONFLICT, Code.TEAM_RETIRED)

    return None


def offered_gruppen(number_of_gruppen: int) -> tuple[FLGruppenNames, ...]:
    return get_args(FLGruppenNames.__value__)[:number_of_gruppen]


def find_gruppe_move_refusal(*, drawn: bool) -> APIError | None:
    """Why this team's group move must be refused, or `None`.

    The window is a season where this team holds no fixture, whatever the season's status: a move
    rewrites none, so a later one leaves one round robin holding the club and the other short.
    """

    if not drawn:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.ENTRY_GRUPPE_LOCKED)


def find_austritt_standing_refusal(*, stored: Mapping[str, Any] | None) -> APIError | None:
    """`version_stale`: this row's exit stands, so the page offering another was read before it.

    An exit is never lifted, and its notices and closed confirmations have gone out, so nothing replaces it, whatever
    the write carries. The record's presence is the whole comparison: the write sends no version.
    """

    if stored is None:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.VERSION_STALE)


def find_austritt_refusal(*, start_date: str, started: bool) -> APIError | None:
    """Why recording this exit must be refused, or `None`: the season has not started, and the replacement swaps its club out instead.

    Judged on the act, whatever day the exit is dated: while the season has not started the group swap stays open, and an
    exit standing then would leave the swap fielding a departed club. The season save refuses moving the start past a
    stored exit, so an exit never stands on a season that reads as unstarted again. The refusal names the exit's `date`,
    and `earliest` is the first day an exit may be recorded.
    """

    if started:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.AUSTRITT_BEFORE_SAISON_START, fields=(("date",),), bounds={"earliest": start_date})


def find_entry_saison_refusal(*, saison_status: str) -> APIError | None:
    """`entry_saison_not_future`: only a planned season takes an entry. Asked of an entry alone, never of a group move."""

    if saison_status == "future":
        return None

    return APIError(HTTPStatus.CONFLICT, Code.ENTRY_SAISON_NOT_FUTURE)


def find_entry_refusal(gruppe: FLGruppenNames, rules: FLSaisonRules, occupied: int) -> APIError | None:
    """Why placing this team into the group must be refused, or `None`, an entry's and a group move's alike.

    `occupied` is the group's row count, rows carrying an `austritt` included: a team never leaves a
    season, so its place stays taken.
    """

    if gruppe not in offered_gruppen(rules.number_of_gruppen):
        return APIError(HTTPStatus.CONFLICT, Code.ENTRY_GRUPPE_NOT_OFFERED)

    if occupied >= rules.teams_per_gruppe:
        return APIError(HTTPStatus.CONFLICT, Code.ENTRY_GRUPPE_FULL)

    return None


def find_replacement_pair_refusal(*, team_id: Any, incoming_team_id: Any) -> APIError | None:
    """Why this replacement names one club on both ends, or `None`. Judged before any read."""

    if team_id != incoming_team_id:
        return None

    return APIError(HTTPStatus.UNPROCESSABLE_CONTENT, Code.REPLACE_ONE_TEAM_ON_BOTH_ENDS, fields=(("incoming_team_id",),))


def find_replacement_refusal(
    *,
    saison_status: str,
    # Once the season is under way, a club leaves it by its Austritt and is never replaced. Before the
    # start the save refuses a result, which keeps the incoming club from inheriting a record it never made.
    started: bool,
    incoming_inactive_since: str | None,
    incoming_already_entered: bool,
) -> APIError | None:
    """Why handing this row to another club must be refused, or `None`.

    **The order is the argument**: the season, then the incoming club -- so a repairable refusal never
    sends anyone to repair a doomed replacement.
    """

    if saison_status == "past":
        return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)

    if started:
        return APIError(HTTPStatus.CONFLICT, Code.REPLACE_SAISON_STARTED)

    # The league before the season: a club that has left the league
    # is a candidate for no season at all, and picking a different one would not repair it.
    retired = find_team_entry_refusal(inactive_since=incoming_inactive_since)
    if retired is not None:
        return retired

    if incoming_already_entered:
        return APIError(HTTPStatus.CONFLICT, Code.REPLACE_INCOMING_ALREADY_ENTERED)

    return None


# A club standing in one of these is still in the league's programme, so retiring it is refused.
_RETIRE_BLOCKING_STATUSES: tuple[str, ...] = ("active", "future")


def saison_blocking_retirement(saisons: Iterable[Mapping[str, Any]]) -> str | None:
    """The newest of these seasons that blocks retiring the club, which the editor names, or `None`."""

    return max((str(saison["_id"]) for saison in saisons if saison["status"] in _RETIRE_BLOCKING_STATUSES), default=None)


def find_retire_refusal(saison_statuses: Iterable[str]) -> APIError | None:
    """Why retiring this club must be refused, or `None`; a club whose seasons are all `past` may be retired."""

    if not any(saison_status in _RETIRE_BLOCKING_STATUSES for saison_status in saison_statuses):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.RETIRE_BLOCKED)

"""
API · the registration's judgements, spelled apart from the request

Every predicate here takes values and never a collection or a session: the router does the reading,
so a refusal is judged against what the submission's own transaction can see.
"""

from collections.abc import Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after, mailbox_pattern, season_has_ended
from app.api.outbox.schemas import FLOutboxLink, FLOutboxReference, FLRegistrierungLinkData
from app.api.outbox.services import OwedMail
from app.api.saisons.services import entry_is_a_nominee
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal
from app.shared.age import whole_years_between
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import TextVersions, compose_initial, compose_renewed
from app.shared.folding import person_name_key, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    DECLINED_RETENTION_DAYS,
    LIST_LIMIT_DEFAULT,
    REGISTRIERUNG_MIN_AGE_YEARS,
)
from app.shared.schemas.literals import FLConfirmationState

# --- The INVITE's read and the SUBMISSION. Every refusal below is judged before the one write, in
# the order the router asks them in.

# The state a submission arrives in, and the only one it may arrive in: the other is written by the
# team's decline.
SUBMITTED = "submitted"


def saison_takes_registrierungen(*, saison_status: Any, registrierung: Any) -> bool:
    """Whether this season takes a registration: the season the site is on, its link not paused.

    The window opens at the activation, so a `future` season takes none whatever its window says, and a `past` one is
    over for good, a link minted earlier outliving it. Its `end` closes nothing: an entry past it is a nominee
    (`app/api/saisons/services.py :: entry_is_a_nominee`), through the same link until the season ends. The window is
    null or the whole object the season form writes. One predicate answers every `running` a link is shown with and
    this flow's refusal, so a link and the write it opens cannot disagree.
    """

    return registrierung is not None and saison_status == "active" and bool(registrierung["open"])


def find_window_refusal(*, saison_status: Any, registrierung: Any) -> WriteRefusal | None:
    """Why this season takes no registration today, or `None`.

    ONE code for every way `saison_takes_registrierungen` says no: naming which would report a
    season's administrative state to an anonymous visitor.
    """

    if saison_takes_registrierungen(saison_status=saison_status, registrierung=registrierung):
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_CLOSED,
        status=HTTPStatus.CONFLICT,
    )


def find_team_departed_refusal(*, austritt: Any) -> WriteRefusal | None:
    """`document_not_found`: the invite's team has left the season, so its link opens nothing, as a revoked invite's does.

    The record's presence and never its `date`, as a seat's grant reads it.
    """

    if austritt is None:
        return None

    return WriteRefusal(
        error_code=Code.DOCUMENT_NOT_FOUND,
        status=HTTPStatus.NOT_FOUND,
    )


def find_team_junction_refusal(*, entered: bool) -> WriteRefusal | None:
    """`registrierung_closed`: the season holds no junction row for the invite's team.

    Its own code rather than the squad write's `kader_team_not_in_saison`, which is worded for an
    administrator entering a player: one rule keeps one German sentence.
    """

    if entered:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_CLOSED,
        status=HTTPStatus.CONFLICT,
    )


def find_stufe_refusal(*, stufe: Any, allowed_stufen: Sequence[str]) -> WriteRefusal | None:
    """`registrierung_stufe_not_allowed`: the season's rules do not offer this Stufe.

    A null passes: the form may leave it unanswered. Refused server-side because
    the rule protects a STORED row, and nobody has stored this one.
    """

    if stufe is None or stufe in allowed_stufen:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_STUFE_NOT_ALLOWED,
        status=HTTPStatus.CONFLICT,
    )


def admits_a_nominee(*, kader_raw: Mapping[str, Any] | None, registrierung: Mapping[str, Any] | None, submitted_at: str) -> bool:
    """Whether admitting a registration enters a Nachnominierung, which the cap does not hold.

    The person's stored mark of the season first, never lifted within it whatever the window has moved to since; else
    the season's window, judged on the day the pupil submitted and never today.
    """

    return (kader_raw is not None and bool(kader_raw["is_nachnominiert"])) or entry_is_a_nominee(registrierung=registrierung, day=submitted_at)


def find_kader_refusal(*, full: WriteRefusal | None) -> WriteRefusal | None:
    """`registrierung_kader_full`: the squad has no room for this entry, the answer the link's `kader_free` gives.

    `full` is `app/api/spieler/services.py :: find_full_squad_refusal`'s verdict, the cap's one copy, which this words
    for the link's holder rather than for the administrator entering a player.
    """

    if full is None:
        return None

    # No figure in the message: a stranger holding a link learns nothing about a squad's size.
    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_KADER_FULL,
        status=HTTPStatus.CONFLICT,
    )


def compose_registrierung(
    *,
    saison_id: str,
    team_id: Any,
    invitation_id: Any,
    first_name: str,
    last_name: str,
    email: str,
    position: str | None,
    nummer: str | None,
    stufe: str | None,
    confirmation: dict[str, Any],
    today: str,
) -> dict[str, Any]:
    """One pending registration as the submission writes it.

    No late-entry marker of either spelling: it is a fact about the squad entry an admission writes
    weeks later, and one derived here would carry the wrong season's state.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "invitation_id": invitation_id,
        "submitted_at": today,
        "status": SUBMITTED,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        # Written EXPLICITLY, all three: the record model requires each key, so an omitted one is a
        # document the read-back refuses rather than a stored null.
        "position": position,
        "nummer": nummer,
        "stufe": stufe,
        # Both null until the pupil's own confirmation writes them in one `$set`.
        "birth_date": None,
        "einwilligung": None,
        "confirmation": confirmation,
        # Null until a decline writes it; an admission deletes the row instead.
        "decision": None,
    }


# Where a registration's mailed link lives, and the address it is minted for while the row still holds it.
REGISTRIERUNG_LINK: Final = FLOutboxLink(paths=["confirmation.token_hashes"], addresses=["email"], replaced=False)


def compose_confirmation(*, today: str, deadline: str, mailed: bool) -> dict[str, Any]:
    """The confirmation bookkeeping a submission, or a move of an unconfirmed row, writes: owed today, no link until the hand-out mints one.

    `deadline` is stored rather than derived from `sent_at` and the bound, so raising the bound
    never moves the deadline of a link already in somebody's inbox. A row past `OPEN_LINKS_PER_MAILBOX` is owed no mail:
    its `sent_at` is null, and it lapses on its `deadline` as any unconfirmed row does.
    """

    return {"token_hashes": [], "sent_at": today if mailed else None, "deadline": deadline}


def confirmation_mail(*, registrierung_id: Any, key: str, address: str, team: str, saison_id: str) -> OwedMail:
    """The pupil's confirmation mail, its link minted at the hand-out while the row still holds `address`.

    `team` is the junction row's name, off the club's season row and never a payload: anyone holding the team's link
    could otherwise word the league's message.
    """

    return OwedMail(
        key=key,
        to=address,
        data=FLRegistrierungLinkData(kind="registrierung_confirmation", team=team, saison_id=saison_id),
        reference=FLOutboxReference(collection=Collection.REGISTRIERUNGEN, id=registrierung_id, seat=None),
        link=REGISTRIERUNG_LINK,
    )


def build_open_link_filter(*, saison_id: str, address: str) -> Mapping[str, Any]:
    """The season's pending registrations holding a mailed, unconfirmed link at this address's mailbox, the plus-tagged forms among them."""

    return {
        "saison_id": saison_id,
        "status": SUBMITTED,
        "email": {"$regex": mailbox_pattern(address)},
        "einwilligung.confirmed_at": None,
        "confirmation.sent_at": {"$ne": None},
    }


def registrierung_is_confirmed(*, einwilligung: Any) -> bool:
    """Whether the pupil answered their own link, which is what makes a row admissible.

    Off the consent record's own stamp, never the `confirmation` block beside it: that one says a
    message went out rather than that anybody answered.
    """

    return is_confirmed(einwilligung)


def registrierung_was_left_unmailed(*, confirmation: Any) -> bool:
    """Whether no mail is owed this row, which the block's null `sent_at` keeps.

    Its submission's or its address move's mailbox stood past `OPEN_LINKS_PER_MAILBOX`, or the move found its link over.
    """

    return isinstance(confirmation, Mapping) and confirmation.get("sent_at") is None


# The admin read's projection, an EXCLUSION for the reason `app/api/bewerbungen/services.py ::
# WITHOUT_TOKEN_HASHES` is one: an inclusion list would restate every field a registration holds.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {"confirmation.token_hashes": 0}


# What the admin list reads of a row, the consent's stamp alone of its record, which `registrierung_is_confirmed` judges,
# and the mail's, which `registrierung_was_left_unmailed` does.
REGISTRIERUNG_LIST_FIELDS: Final = ("first_name", "last_name", "team_id", "submitted_at", "einwilligung.confirmed_at", "confirmation.sent_at")


def build_registrierungen_sort() -> list[tuple[str, int]]:
    """The pending list's order: newest first by `submitted_at`, tie-broken by `_id` in the same direction.

    One key, the one the collection's queue index sorts on: a second would plan a blocking sort over a
    list an outside form writes. The pair is that index's own key order, so the read walks it.
    """

    return build_sort(sort_by="submitted_at", order="desc", chain=(("_id", -1),))


# --- The CONFIRMATION. Every predicate below reads a missing `confirmation` block as "nothing to
# confirm".


def build_confirmation_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every link the row was mailed.

    No status term: a link reopened on a decided registration shows its own state rather than
    reading as a token nothing knows.
    """

    return {"confirmation.token_hashes": token_hash}


# An INCLUSION, so the rest of a registration -- the names, the address, the shirt number, the position and the
# Stufe -- is what this base-tier read cannot serve.

# NEITHER hash is projected: the FILTER above matches on them, and a hash a handler never reads is a
# credential carried through a base-tier request for nothing.
CONFIRMATION_VIEW_FIELDS: Mapping[str, int] = {
    "confirmation.deadline": 1,
    "status": 1,
    "saison_id": 1,
    "team_id": 1,
    # The stamp alone: nothing the pupil answered reaches the link's view.
    "einwilligung.confirmed_at": 1,
    # Suppressed here alone: only the answer's read below has a patch filter to key on it.
    "_id": 0,
}

# The view's fields beside the id its write is keyed on: the press judges the link, the stamp and the club's row.
CONFIRMATION_ANSWER_FIELDS: Mapping[str, int] = {
    "confirmation.deadline": 1,
    "status": 1,
    "saison_id": 1,
    "team_id": 1,
    "einwilligung.confirmed_at": 1,
}


def deadline_of(confirmation: Any) -> Any:
    return confirmation.get("deadline") if isinstance(confirmation, Mapping) else None


def link_is_over(*, confirmation: Any, status: Any, departed: bool, today: str) -> bool:
    """Whether the link is over: the registration was decided, its club has left the season, or its deadline has passed."""

    # A departed club takes no one in, so a link still asking would collect an answer nobody can admit.
    if status != SUBMITTED or departed:
        return True

    # No readable deadline is OVER rather than running: nothing about such a block can say it runs.
    deadline = deadline_of(confirmation)

    # Strictly past, so the deadline's own day still answers: the mail names that day, and a link
    # dying at the midnight before it lies to the person reading the mail.
    return not isinstance(deadline, str) or deadline < today


def state_of(*, registrierung_raw: Mapping[str, Any], departed: bool, today: str) -> FLConfirmationState:
    """What a reopened link shows: a stamp over the deadline.

    A pupil who answered on the last valid day is shown that they did.
    """

    if registrierung_is_confirmed(einwilligung=registrierung_raw.get("einwilligung")):
        return "confirmed"

    over = link_is_over(
        confirmation=registrierung_raw.get("confirmation"), status=registrierung_raw.get("status"), departed=departed, today=today
    )

    return "expired" if over else "valid"


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown and for swept with the registration: nothing tells either from a stranger's
    guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=Code.LINK_INVALID,
        status=HTTPStatus.NOT_FOUND,
    )


def find_expired_token_refusal(*, confirmation: Any, status: Any, departed: bool, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the stamp: a registration decided while the link stood open takes no answer either."""

    if not link_is_over(confirmation=confirmation, status=status, departed=departed, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this registration takes no second answer, or `None`. The single use: the stamp is what spends a link, never a nulled hash."""

    if not registrierung_is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_EXISTS,
        status=HTTPStatus.CONFLICT,
    )


def find_age_refusal(*, birth_date: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    # The pupil's own floor and never a contact seat's, so raising one cannot silently raise the other; the ceiling is
    # every consent flow's, refusing a mistyped century rather than a real age. One range, as the referee's is judged.
    if REGISTRIERUNG_MIN_AGE_YEARS <= whole_years_between(born=birth_date, today=today) <= BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("birth_date",),),
        bounds={"min": REGISTRIERUNG_MIN_AGE_YEARS, "max": BEWERBUNG_KONTAKT_MAX_AGE_YEARS},
    )


def build_addresses_filter(addresses: Iterable[str]) -> Mapping[str, Any]:
    """The persons stored under these folded addresses, matched as `uniq_spieler_email` serves it.

    The `$type` term is the index's partial filter: an equality alone does not imply it, and without
    it the planner scans every person.
    """

    return {"email": {"$in": sorted(set(addresses)), "$type": "string"}}


# Which fields say WHO a stored person is, as `app/api/teams/services.py :: SEAT_IDENTITY_FIELDS`
# says it of a contact seat.
PERSON_IDENTITY_FIELDS: tuple[str, ...] = ("first_name", "last_name")


def person_name(raw: Mapping[str, Any]) -> tuple[str, ...] | None:
    """`None` where either half is blank, a blank name being nobody's (`app/api/kontakte/services.py :: seat_name`)."""

    # The seat editor's fold (`app/api/teams/services.py :: _identity_of`), so „Weiß“ and „Weiss“ at
    # one shared mailbox are two pupils and neither is shown the other's record.
    name = tuple(person_name_key(raw.get(field)) for field in PERSON_IDENTITY_FIELDS)

    return name if all(name) else None


def compose_confirmation_update(
    *, birth_date: str, scope: str, media: bool, text_versions: TextVersions, today: str, at: str
) -> Mapping[str, Any]:
    """The ONE `$set` a confirmation is: the whole consent record beside the date.

    The two land together, and between two writes the row
    would hold a birthdate nobody had yet consented to the league keeping.
    """

    # Born whole rather than moved: the submission stores no record and a second press is refused, so
    # no earlier choice stands on this block; the admission carries its evidence onto the person.
    record = compose_initial(
        block={
            "scope": scope,
            # `date` and `confirmed_at` are one day here: this press is both the giving of the
            # consent and the confirming of it.
            "date": today,
            "confirmed_at": today,
            "media": media,
        },
        at=at,
        text_versions=text_versions,
    )

    return {"$set": {"birth_date": birth_date, "einwilligung": record}}


# --- The retention SWEEP. Each clock is a pure predicate over one document and `today`.

# The other member of the status enum, read by the clock below and written by the team's decline.
DECLINED: Final = "declined"

# One row per PUPIL, so a season's registrations outgrow a page long before its fixtures do.
SWEEP_PAGE: Final = LIST_LIMIT_DEFAULT

# The consent stamp, at the path a null `einwilligung` and a null stamp both answer: null matches a
# missing path too, so one term covers both stored shapes.
_UNCONFIRMED: Final[Mapping[str, Any]] = {"einwilligung.confirmed_at": None}


def build_undecided_filter(*, saison_id: str) -> Mapping[str, Any]:
    """Every submitted row of this season, the clock taking each one once the season is `past`."""

    return {"saison_id": saison_id, "status": SUBMITTED}


def build_unconfirmed_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every submitted, unconfirmed row whose deadline is behind it.

    A comparison matches one BSON type, so a row carrying no readable deadline is never read here --
    and never due either, the predicate refusing exactly that row.
    """

    return {"saison_id": saison_id, "status": SUBMITTED, **_UNCONFIRMED, "confirmation.deadline": {"$lt": today}}


def build_decline_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every declined row whose days are behind it, as `decline_erasure_is_due` judges it.

    In the query: a page of decisions still inside their days would fill the read ahead of a due
    one, and the stall refuses the pass.
    """

    return {"saison_id": saison_id, "status": DECLINED, "decision.made_at": {"$lte": days_after(day=today, days=-DECLINED_RETENTION_DAYS)}}


def confirmation_erasure_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the deadline clock takes this registration, strictly past its `deadline`.

    STRICTLY, because the link still answers on the deadline's own day. No notice goes out either
    way.
    """

    if registrierung_raw.get("status") != SUBMITTED:
        return False

    if registrierung_is_confirmed(einwilligung=registrierung_raw.get("einwilligung")):
        return False

    deadline = deadline_of(registrierung_raw.get("confirmation"))

    return isinstance(deadline, str) and deadline < today


def undecided_erasure_is_due(*, registrierung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this registration.

    Whatever the pupil answered and whether or not a message could reach them: no admission can be
    taken for a season that is over.
    """

    return registrierung_raw.get("status") == SUBMITTED and season_has_ended(saison_status=saison_status)


def decline_erasure_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the decline clock takes this declined registration, counted from the day the decision was taken."""

    if registrierung_raw.get("status") != DECLINED:
        return False

    decision = registrierung_raw.get("decision")
    made_at = decision.get("made_at") if isinstance(decision, Mapping) else None

    return isinstance(made_at, str) and days_after(day=made_at, days=DECLINED_RETENTION_DAYS) <= today


# --- The TEAM's decision: the pending read, the admission and the decline a seat holder makes.


def build_open_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """One team's pending rows, on the equality prefix `registrierungen_saison_id_team_id_queue` sorts after."""

    return {"saison_id": saison_id, "team_id": team_id, "status": SUBMITTED}


def build_confirmed_open_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """One team's pending rows a pupil confirmed, stating `registrierungen_saison_id_team_id_confirmed_queue`'s partial filter whole.

    A stamp is a stored day, so `$type` matches exactly the confirmed rows; `$ne: null` would match them too and keep the
    planner off the partial index.
    """

    return {**build_open_filter(saison_id=saison_id, team_id=team_id), "einwilligung.confirmed_at": {"$type": "string"}}


def build_unconfirmed_open_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """One team's pending rows nobody confirmed, on `registrierungen_saison_id_team_id_queue`: null matches a missing stamp too."""

    return {**build_open_filter(saison_id=saison_id, team_id=team_id), "einwilligung.confirmed_at": None}


def build_own_registrierung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every pending registration of these addresses, on `registrierungen_email_status`."""

    return {**build_erasure_registrierung_filter(*identifiers), "status": SUBMITTED}


def build_erasure_registrierung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every registration of these addresses, of every status: a declined row holds the same person until its days are out."""

    # Folded here, the form every registration stores.
    return {"email": {"$in": sorted({sign_in_identifier(identifier) for identifier in identifiers})}}


def build_admission_erasure_filter(*, registrierung_id: Any, saison_id: str, address: str) -> Mapping[str, Any]:
    """The admitted registration and every other pending one of its address in its season, whichever team each was for.

    Once the person plays, each of the others is refused as already in a squad, a season holding one squad row per
    person, and the decline left as its only press would mail the pupil just admitted. Keyed on the fold the admission
    resolves the person by, never on the mailbox's plus-tagged forms: each of those resolves to another person.
    """

    return {"saison_id": saison_id, "$or": [{"_id": registrierung_id}, dict(build_own_registrierung_filter(address))]}


def find_unknown_registrierung_refusal(*, found: bool) -> WriteRefusal | None:
    """`role_not_held` for an id no registration holds, the answer the seat check gives another team's row.

    One answer for both, so a signed-in stranger learns nothing of which ids exist.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=Code.ROLE_NOT_HELD,
        status=HTTPStatus.FORBIDDEN,
    )


def find_unconfirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """`registrierung_unconfirmed`: the pupil has not answered their own link, so nobody may admit them yet.

    Asked at the write as well as marked on the read: the list and the press are two requests.
    """

    if registrierung_is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_UNCONFIRMED,
        status=HTTPStatus.CONFLICT,
    )


def person_deviates(*, registrierung_raw: Mapping[str, Any], spieler_raw: Mapping[str, Any]) -> bool:
    """Whether the person an address resolves to is named or born otherwise than the registration says."""

    # A blank name names nobody, so it confirms nobody either.
    if (name := person_name(registrierung_raw)) is None or name != person_name(spieler_raw):
        return True

    return spieler_raw.get("birth_date") != registrierung_raw.get("birth_date")


def find_person_refusal(
    *,
    registrierung_raw: Mapping[str, Any],
    address_raw: Mapping[str, Any] | None,
    spieler_id: Any,
) -> WriteRefusal | None:
    """`registrierung_person_not_named`: the body names nobody this registration may be admitted into.

    A resolved address IS the person: the body only confirms it, and must where name or birthdate
    differ. Otherwise it names nobody, for a new person.
    """

    if address_raw is not None:
        answered = spieler_id == address_raw["_id"] or (
            spieler_id is None and not person_deviates(registrierung_raw=registrierung_raw, spieler_raw=address_raw)
        )
    else:
        answered = spieler_id is None

    if answered:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_PERSON_NOT_NAMED,
        status=HTTPStatus.CONFLICT,
    )


def find_already_in_kader_refusal(*, kader_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`registrierung_already_in_kader`: the person already plays in a squad this season, and a season holds one row per player.

    A RETIRED row is no refusal: the admission rewrites it, whichever team it was on.
    """

    if kader_raw is None or kader_raw.get("inactive_since") is not None:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_ALREADY_IN_KADER,
        status=HTTPStatus.CONFLICT,
    )


def nummern_in_kader(rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The shirt numbers the live squad wears, compared as stored strings: „07“ is not „7“."""

    return frozenset(nummer for row in rows if isinstance(nummer := row.get("nummer"), str))


def _person_fields(*, registrierung_raw: Mapping[str, Any], address: str) -> dict[str, Any]:
    # Here as well as in the `spieler` record model, which the read-back alone applies: every person the admission
    # writes passes here, and the administrator's edit requires one by its payload.
    if not person_name_key(registrierung_raw.get("first_name")):
        raise ValueError("a registration carrying no forename names no person")

    return {
        **{field: registrierung_raw[field] for field in (*PERSON_IDENTITY_FIELDS, "birth_date")},
        "email": address,
    }


def compose_person_update(*, registrierung_raw: Mapping[str, Any], saved: Any, address: str) -> Mapping[str, Any]:
    """What an admission writes onto a matched person: the registration's name, birthdate, address and consent.

    RENEWED as the confirmation page promised, each choice only where set later; `saved` is read
    in the admission's transaction.
    """

    fields = _person_fields(registrierung_raw=registrierung_raw, address=address)
    # No write stores a person without a record, so a matched person holding none is a hand edit: renewing fails on the
    # dotted paths below, and leaving it keeps a person nobody asked.
    if not isinstance(saved, Mapping):
        raise ValueError("a matched person holding no consent record is no person to admit")

    renewed = compose_renewed(
        path="einwilligung",
        saved=saved,
        renewed=registrierung_raw["einwilligung"],
    )

    return {"$set": {**fields, **renewed}}


def compose_person(*, spieler_id: Any, registrierung_raw: Mapping[str, Any], address: str) -> dict[str, Any]:
    """A new person, from the registration alone: its record carried whole, evidence included."""

    fields = _person_fields(registrierung_raw=registrierung_raw, address=address)

    return {"_id": spieler_id, **fields, "einwilligung": dict(registrierung_raw["einwilligung"])}


def compose_kader_fields(*, registrierung_raw: Mapping[str, Any], team_id: Any, is_nachnominiert: bool) -> dict[str, Any]:
    """The squad row's fields, written fresh or onto this person's retired row.

    No `rolle`: a registration carries none, and a retired row's captaincy would return to a squad
    that may have given it away.
    """

    return {
        "team_id": team_id,
        **{field: registrierung_raw.get(field) for field in ("nummer", "position", "stufe")},
        "rolle": None,
        "is_nachnominiert": is_nachnominiert,
        "inactive_since": None,
    }


def compose_decline_update(*, reason: Any, today: str) -> Mapping[str, Any]:
    return {"$set": {"status": DECLINED, "decision": {"made_at": today, "reason": reason}}}

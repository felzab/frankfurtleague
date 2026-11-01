"""
API · the registration's judgements, spelled apart from the request

Every predicate here takes values and never a collection or a session: the router does the reading,
so a refusal is judged against what the submission's own transaction can see.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after, latest_decision_due, one_month_after, season_has_ended

# The window predicate is the invite slice's, and `saison_nimmt_registrierungen_an` below answers
# every `running` a link is shown with and this flow's refusal, so a link and the write it opens
# cannot disagree.
from app.api.einladungen.services import registrierungsfenster_laeuft
from app.api.outbox.schemas import FLOutboxLink
from app.api.registrierungen.schemas import FLRegistrierungEntscheidung, FLRegistrierungSeite

# The application sweep's own date arithmetic and its refusal vocabulary: the two flows count a
# month and read a provider's verdict the same way, and a second spelling would drift from it.
from app.api.sperrliste.services import withheld_actor
from app.core.codes import Code
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import compose_erneuert, compose_geboren
from app.shared.folding import person_name_key, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    LIST_LIMIT_MAX,
    MEDIEN_MIN_AGE_YEARS,
    REGISTRIERUNG_MIN_AGE_YEARS,
    REGISTRIERUNG_REMINDER_DAYS,
)
from app.shared.schemas.literals import FLConfirmationState

# --- The INVITE's read and the SUBMISSION. Every refusal below is judged before the one write, in
# the order the router asks them in.

# The state a submission arrives in, and the only one it may arrive in: the other is written by the
# team's decline.
SUBMITTED = "submitted"


def saison_nimmt_registrierungen_an(*, saison_status: Any, registrierung: Any, today: str) -> bool:
    """Whether this season takes a registration on `today`.

    A finished season's window is over for good, whatever dates it still stores: a link minted
    while the season was `future` outlives the season, and the dates alone would still admit.
    """

    return not season_has_ended(saison_status=saison_status) and registrierungsfenster_laeuft(registrierung=registrierung, today=today)


def find_fenster_refusal(*, saison_status: Any, registrierung: Any, today: str) -> WriteRefusal | None:
    """Why this season takes no registration today, or `None`.

    ONE code for every way `saison_nimmt_registrierungen_an` says no: naming which would report a
    season's administrative state to an anonymous visitor.
    """

    if saison_nimmt_registrierungen_an(saison_status=saison_status, registrierung=registrierung, today=today):
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_CLOSED,
        status=HTTPStatus.CONFLICT,
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


def find_kader_refusal(*, squad_size: int, max_kadergroesse: int) -> WriteRefusal | None:
    """`registrierung_kader_full`: the squad already stands at the season's cap.

    Over the same two numbers the administrator's Kader editor compares, and asked on every
    submission rather than inside the Nachnominierung period alone, so two writers cannot disagree
    about a full squad.
    """

    if squad_size < max_kadergroesse:
        return None

    # No figure in the message: a stranger holding a link learns nothing about a squad's size.
    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_KADER_FULL,
        status=HTTPStatus.CONFLICT,
    )


def find_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """`registrierung_adresse_barred`: the ban list holds the address this registration was typed with.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if not barred:
        return None

    # NEUTRAL: an administrator is told plainly what a visitor is told neutrally, so a stranger
    # learns from this that the address is unusable and nothing about a list.
    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_ADRESSE_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def compose_registrierung(
    *,
    saison_id: str,
    team_id: Any,
    invitation_id: Any,
    vorname: str,
    nachname: str,
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
        "vorname": vorname,
        "nachname": nachname,
        "email": email,
        # Written EXPLICITLY, all three: the record model requires each key, so an omitted one is a
        # document the read-back refuses rather than a stored null.
        "position": position,
        "nummer": nummer,
        "stufe": stufe,
        # Both null until the pupil's own confirmation writes them in one `$set`.
        "geburtsdatum": None,
        "einwilligung": None,
        "confirmation": confirmation,
        # Null until a decline writes it; an admission deletes the row instead.
        "decision": None,
    }


# Where a registration's mailed link lives, and the address it is minted for while the row still holds it. Never
# superseding: a reminder's link joins the first one, so a pupil still reading the first mail is not punished by the chase.
REGISTRIERUNG_LINK: Final = FLOutboxLink(paths=["confirmation.token_hashes"], adressen=["email"], replaced=False)


def compose_bestaetigung(*, today: str, frist: str) -> dict[str, Any]:
    """The confirmation bookkeeping the submission writes: owed today, nobody reminded, no link until the hand-out mints one.

    `frist` is stored rather than derived from `sent_at` and the bound, so raising the bound
    never moves the deadline of a link already in somebody's inbox.
    """

    return {"token_hashes": [], "sent_at": today, "reminded_at": None, "frist": frist}


# --- The SUBMISSION KEY, as the application's submission keeps it
# (`app/api/bewerbungen/services.py :: payload_fingerabdruck`).


def find_abweichender_fingerabdruck_refusal(*, gespeichert: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why this key cannot be replayed, or `None`: it already carries a registration sent with other details.

    Refused rather than answered as the stored one, which would tell the pupil a changed field had
    arrived.
    """

    if gespeichert == fingerabdruck:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_KEY_DIFFERING,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
    )


def registrierung_ist_bestaetigt(*, einwilligung: Any) -> bool:
    """Whether the pupil answered their own link, which is what makes a row admissible.

    Off the consent record's own stamp, never the `confirmation` block beside it: that one says a
    message went out rather than that anybody answered.
    """

    return is_confirmed(einwilligung)


# The admin read's projection, an EXCLUSION for the reason `app/api/bewerbungen/services.py ::
# WITHOUT_TOKEN_HASHES` is one: an inclusion list would restate every field a registration holds.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {"confirmation.token_hashes": 0}


def build_registrierungen_sort(*, sort_by: str, order: str) -> list[tuple[str, int]]:
    """The pending list's order, tie-broken by `_id` in `order`'s OWN direction.

    That direction makes the pair the index's key or its exact inverse; pinned descending,
    `order=asc` would match neither and scan the collection.
    """

    direction = 1 if order == "asc" else -1

    return build_sort(sort_by=sort_by, order=order, chain=(("_id", direction),))


# --- The CONFIRMATION. Every predicate below reads a missing `confirmation` block as "nothing to
# confirm".


# The two pages one link opens, each with its running label (`app/shared/einwilligung.py :: LAUFENDE_FASSUNGEN`).
SEITE_NEU: Final[FLRegistrierungSeite] = "bestaetigung_spieler"
SEITE_WIEDERKEHREND: Final[FLRegistrierungSeite] = "bestaetigung_spieler_wiederkehrend"


def build_bestaetigung_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every link the row was mailed, so a reminded pupil's first link still opens it beside the reminder's.

    No status term: a link reopened on a decided registration shows its own state rather than
    reading as a token nothing knows.
    """

    return {"confirmation.token_hashes": token_hash}


# An INCLUSION, so the rest of a registration -- the surname, the shirt number, the position and the
# Stufe -- is what this base-tier read cannot serve.

# NEITHER hash is projected: the FILTER above matches on them, and a hash a handler never reads is a
# credential carried through a base-tier request for nothing.
BESTAETIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    "confirmation.frist": 1,
    "status": 1,
    "saison_id": 1,
    "team_id": 1,
    "vorname": 1,
    # Both read for the join finding the person the league may already hold, and answered by
    # neither read: the name narrows the address, for the reason `persons_named` gives.
    "nachname": 1,
    "email": 1,
    # The stamp alone: nothing the pupil answered reaches the link's view.
    "einwilligung.confirmed_at": 1,
    # Suppressed here alone: only the answer's read below has a patch filter to key on it.
    "_id": 0,
}

# Narrower than the view's: the press judges the link, the stamp, the address the ban list is asked
# of and the name its page is resolved by, and names no team.
BESTAETIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    "confirmation.frist": 1,
    "status": 1,
    "einwilligung.confirmed_at": 1,
    "email": 1,
    "vorname": 1,
    "nachname": 1,
}


def frist_of(confirmation: Any) -> Any:
    return confirmation.get("frist") if isinstance(confirmation, Mapping) else None


def link_is_over(*, confirmation: Any, status: Any, today: str) -> bool:
    """Whether the link is over: the registration was decided, or its deadline has passed."""

    if status != SUBMITTED:
        return True

    # No readable deadline is OVER rather than running: nothing about such a block can say it runs.
    frist = frist_of(confirmation)

    # Strictly past, so the deadline's own day still answers: the mail names that day, and a link
    # dying at the midnight before it lies to the person reading the mail.
    return not isinstance(frist, str) or frist < today


def zustand_of(*, registrierung_raw: Mapping[str, Any], today: str, barred: bool) -> FLConfirmationState:
    """What a reopened link shows: the ban first, then a stamp over the deadline.

    A pupil who answered on the last valid day is shown that they did.
    """

    if barred:
        return "barred"

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return "confirmed"

    over = link_is_over(confirmation=registrierung_raw.get("confirmation"), status=registrierung_raw.get("status"), today=today)

    return "expired" if over else "valid"


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, replaced by a reminder's mint, and swept with the registration: nothing
    tells them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=Code.LINK_INVALID,
        status=HTTPStatus.NOT_FOUND,
    )


def find_expired_token_refusal(*, confirmation: Any, status: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the stamp: a registration decided while the link stood open takes no answer either."""

    if not link_is_over(confirmation=confirmation, status=status, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this registration takes no second answer, or `None`. The single use: the stamp is what spends a link, never a nulled hash."""

    if not registrierung_ist_bestaetigt(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_EXISTS,
        status=HTTPStatus.CONFLICT,
    )


def find_bestaetigung_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """`link_barred`: the ban list holds the address this link was mailed to, however long ago it was minted."""

    if not barred:
        return None

    # 403 and named plainly, where the submission's `registrierung_adresse_barred` is neutral: whoever holds the mailed token
    # holds that mailbox, as a sign-in code's holder does, and the ban's own mail has told them.
    return WriteRefusal(
        error_code=Code.LINK_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_alter_refusal(*, geburtsdatum: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    age = whole_years_between(born=geburtsdatum, today=today)

    # The pupil's own floor and never a contact seat's: raising one must not silently raise the other.
    if age < REGISTRIERUNG_MIN_AGE_YEARS:
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
        )

    # One ceiling over every consent flow, refusing a mistyped century rather than a real age.
    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
        )

    return None


def build_adressen_filter(adressen: Iterable[str]) -> Mapping[str, Any]:
    """The persons stored under these folded addresses, matched as `uniq_spieler_email` serves it.

    The `$type` term is the index's partial filter: an equality alone does not imply it, and without
    it the planner scans every person.
    """

    return {"email": {"$in": sorted(set(adressen)), "$type": "string"}}


# Which fields say WHO a stored person is, as `app/api/teams/services.py :: SEAT_IDENTITY_FIELDS`
# says it of a contact seat.
PERSON_IDENTITY_FIELDS: tuple[str, ...] = ("vorname", "nachname")


def person_name(raw: Mapping[str, Any]) -> tuple[str, ...] | None:
    """`None` where either half is blank, a blank name being nobody's (`app/api/kontakte/services.py :: seat_name`)."""

    # The seat editor's fold (`app/api/teams/services.py :: _identity_of`), so „Weiß“ and „Weiss“ at
    # one shared mailbox are two pupils and neither is shown the other's record.
    name = tuple(person_name_key(raw.get(field)) for field in PERSON_IDENTITY_FIELDS)

    return name if all(name) else None


def persons_named(rows: Sequence[Mapping[str, Any]], *, vorname: Any, nachname: Any) -> list[Mapping[str, Any]]:
    """Every row at this address whose stored name is the registration's own.

    An address holds one stored person (`docs/datenschutz.md :: "One address is one person"`), but a
    sibling registering from a mailbox shared anyway would be shown that person's birthdate.
    """

    if (wanted := person_name({"vorname": vorname, "nachname": nachname})) is None:
        return []

    return [row for row in rows if person_name(row) == wanted]


def sole_person(rows: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    """The one person this narrowed set holds, or `None` where it holds several.

    Anything but exactly one row shows the pupil nothing and asks them as a first-timer, which is
    never wrong; guessing is.
    """

    return rows[0] if len(rows) == 1 else None


def seite_of(*, registrierung_raw: Mapping[str, Any], person_raw: Mapping[str, Any] | None) -> FLRegistrierungSeite:
    """The returning pupil's page only for the confirmed person stored at this address under this name, else the new pupil's.

    It asks no choice, saying the stored ones stand: an unconfirmed record's were given by no person.
    """

    rows = [] if person_raw is None else [person_raw]
    named = sole_person(persons_named(rows, vorname=registrierung_raw.get("vorname"), nachname=registrierung_raw.get("nachname")))

    return SEITE_WIEDERKEHREND if named is not None and is_confirmed(named.get("einwilligung")) else SEITE_NEU


def gespeichertes_geburtsdatum(*, seite: FLRegistrierungSeite, person_raw: Mapping[str, Any] | None) -> str | None:
    """The birthdate the returning pupil's page takes as given, or `None` on the new pupil's, which asks one.

    Never served: the press reads it again in its own transaction.
    """

    return person_raw["geburtsdatum"] if seite == SEITE_WIEDERKEHREND and person_raw is not None else None


def find_wahlen_refusal(*, seite: FLRegistrierungSeite, umfang: Any, medien: Any, geburtsdatum: Any) -> WriteRefusal | None:
    """`registrierung_choices_unsuitable`: the body answers what its page did not ask, or leaves out what it did.

    Both choices and a birthdate on the new pupil's page, none of the three on the returning pupil's.
    """

    gefragt = seite == SEITE_NEU
    if (umfang is not None) == gefragt and (medien is not None) == gefragt and (geburtsdatum is not None) == gefragt:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_CHOICES_UNSUITABLE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
    )


def find_medien_refusal(*, geburtsdatum: str, medien: bool, today: str) -> WriteRefusal | None:
    """Why this pupil's media consent is refused, or `None`.

    Only a `True` is judged: a `False` publishes nothing, and refusing it would refuse the answer the
    page sends every pupil below the floor.
    """

    if not medien or whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS:
        return None

    return WriteRefusal(
        error_code=Code.MEDIEN_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
    )


def compose_confirmation_update(
    *, geburtsdatum: str, umfang: str | None, medien: bool | None, text_version: str, today: str, am: str
) -> Mapping[str, Any]:
    """The ONE `$set` a confirmation is: the whole consent record beside the date.

    The two land together, and between two writes the row
    would hold a birthdate nobody had yet consented to the league keeping.
    """

    if umfang is None and medien is None:
        # The returning pupil's page asked nothing, so the record holds no choice, no evidence and no
        # `datum`, the day a consent was given.
        return {"$set": {"geburtsdatum": geburtsdatum, "einwilligung": {"confirmed_at": today, "text_version": text_version}}}

    if umfang is None or medien is None:
        raise ValueError("a confirmation answers both choices or neither, as `find_wahlen_refusal` holds a body to its page")

    # Born whole rather than moved: the submission stores no record and a second press is refused, so
    # no earlier choice stands on this block; the admission carries its evidence onto the person.
    record = compose_geboren(
        block={
            "umfang": umfang,
            # `datum` and `confirmed_at` are one day here: this press is both the giving of the
            # consent and the confirming of it.
            "datum": today,
            "confirmed_at": today,
            "text_version": text_version,
            "medien": medien,
        },
        am=am,
    )

    return {"$set": {"geburtsdatum": geburtsdatum, "einwilligung": record}}


# --- The retention SWEEP. Each clock is a pure predicate over one document and `today`.

# The other member of the status enum, read by the clock below and written by the team's decline.
DECLINED: Final = "declined"

# One row per PUPIL, so a season's registrations outgrow a page long before its fixtures do.
SWEEP_PAGE: Final = LIST_LIMIT_MAX

# The consent stamp, at the path a null `einwilligung` and a null stamp both answer: null matches a
# missing path too, so one term covers both stored shapes.
_UNBESTAETIGT: Final[Mapping[str, Any]] = {"einwilligung.confirmed_at": None}


def build_undecided_filter(*, saison_id: str) -> Mapping[str, Any]:
    """Every submitted row of this season, the clock taking each one once the season is `past`."""

    return {"saison_id": saison_id, "status": SUBMITTED}


def build_unconfirmed_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every submitted, unconfirmed row whose deadline is behind it.

    A comparison matches one BSON type, so a row carrying no readable deadline is never read here --
    and never due either, the predicate refusing exactly that row.
    """

    return {"saison_id": saison_id, "status": SUBMITTED, **_UNBESTAETIGT, "confirmation.frist": {"$lt": today}}


def build_erinnerung_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every unchased row at its mark, as `erinnerung_is_due` judges it."""

    return {
        "saison_id": saison_id,
        "status": SUBMITTED,
        **_UNBESTAETIGT,
        "confirmation.reminded_at": None,
        "confirmation.frist": {"$gte": today},
        # The mark counted backwards from today, which is the same comparison the predicate makes
        # forwards from the send.
        "confirmation.sent_at": {"$lte": days_after(day=today, days=-REGISTRIERUNG_REMINDER_DAYS)},
    }


def build_decline_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every declined row whose month is behind it, as `decline_loeschung_is_due` judges it.

    In the query: a page of decisions still inside their month would fill the read ahead of a due
    one, and the stall refuses the pass.
    """

    return {"saison_id": saison_id, "status": DECLINED, "decision.made_at": {"$lte": latest_decision_due(today=today)}}


def erinnerung_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether this registration's one reminder is owed today.

    Submitted, unconfirmed, never reminded and inside its deadline. A row past its `frist` is chased
    by nothing: a link minted on the way out is one nobody can spend.
    """

    if registrierung_raw.get("status") != SUBMITTED:
        return False

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return False

    bestaetigung = registrierung_raw.get("confirmation")
    if not isinstance(bestaetigung, Mapping) or bestaetigung.get("reminded_at") is not None:
        return False

    verschickt_am, frist = bestaetigung.get("sent_at"), bestaetigung.get("frist")
    if not isinstance(verschickt_am, str) or not isinstance(frist, str) or frist < today:
        return False

    return days_after(day=verschickt_am, days=REGISTRIERUNG_REMINDER_DAYS) <= today


def bestaetigung_loeschung_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the deadline clock takes this registration, strictly past its `frist`.

    STRICTLY, because the link still answers on the deadline's own day. No notice goes out either
    way.
    """

    if registrierung_raw.get("status") != SUBMITTED:
        return False

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return False

    frist = frist_of(registrierung_raw.get("confirmation"))

    return isinstance(frist, str) and frist < today


def undecided_loeschung_is_due(*, registrierung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this registration.

    Whatever the pupil answered and whether or not a message could reach them: no admission can be
    taken for a season that is over.
    """

    return registrierung_raw.get("status") == SUBMITTED and season_has_ended(saison_status=saison_status)


def decline_loeschung_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the one-month clock takes this declined registration, counted from the day the decision was taken."""

    if registrierung_raw.get("status") != DECLINED:
        return False

    entscheidung = registrierung_raw.get("decision")
    getroffen_am = entscheidung.get("made_at") if isinstance(entscheidung, Mapping) else None

    return isinstance(getroffen_am, str) and one_month_after(day=getroffen_am) <= today


def compose_erinnerung_update(*, today: str) -> Mapping[str, Any]:
    """The reminder's stamp. `sent_at` and `frist` stay: a reminder is not a re-send, and its link joins the first one."""

    return {"$set": {"confirmation.reminded_at": today}}


# --- The TEAM's decision: the pending read, the admission and the decline a seat holder makes.


def build_offene_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """One team's pending rows, on the equality prefix `registrierungen_saison_id_team_id_queue` sorts after."""

    return {"saison_id": saison_id, "team_id": team_id, "status": SUBMITTED}


def build_eigene_registrierung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every pending registration of these addresses, on `registrierungen_email_status`."""

    return {**build_loeschung_registrierung_filter(*identifiers), "status": SUBMITTED}


def build_loeschung_registrierung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every registration of these addresses, of every status: a declined row holds the same person until its month is out."""

    # Folded here, the form every registration stores.
    return {"email": {"$in": sorted({sign_in_identifier(identifier) for identifier in identifiers})}}


def find_unbestaetigt_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """`registrierung_unconfirmed`: the pupil has not answered their own link, so nobody may admit them yet.

    Asked at the write as well as marked on the read: the list and the press are two requests.
    """

    if registrierung_ist_bestaetigt(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_UNCONFIRMED,
        status=HTTPStatus.CONFLICT,
    )


def person_weicht_ab(*, registrierung_raw: Mapping[str, Any], spieler_raw: Mapping[str, Any]) -> bool:
    """Whether the person an address resolves to is named or born otherwise than the registration says."""

    # A blank name names nobody, so it confirms nobody either.
    if (name := person_name(registrierung_raw)) is None or name != person_name(spieler_raw):
        return True

    return spieler_raw.get("geburtsdatum") != registrierung_raw.get("geburtsdatum")


def find_person_fehlt_refusal(*, registrierung_raw: Mapping[str, Any], adresse_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`registrierung_person_missing`: a returning pupil's registration whose person its address holds nobody for.

    It carries no choice, so it cannot create a person; registering again asks them.
    """

    if adresse_raw is not None or traegt_wahlen(registrierung_raw.get("einwilligung")):
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_PERSON_MISSING,
        status=HTTPStatus.CONFLICT,
    )


def find_person_refusal(
    *,
    registrierung_raw: Mapping[str, Any],
    adresse_raw: Mapping[str, Any] | None,
    spieler_id: Any,
) -> WriteRefusal | None:
    """`registrierung_person_not_named`: the body names nobody this registration may be admitted into.

    A resolved address IS the person: the body only confirms it, and must where name or birthdate
    differ. Otherwise it names nobody, for a new person.
    """

    if adresse_raw is not None:
        answered = spieler_id == adresse_raw["_id"] or (
            spieler_id is None and not person_weicht_ab(registrierung_raw=registrierung_raw, spieler_raw=adresse_raw)
        )
    else:
        answered = spieler_id is None

    if answered:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_PERSON_NOT_NAMED,
        status=HTTPStatus.CONFLICT,
    )


def find_schon_im_kader_refusal(*, kader_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`registrierung_already_in_kader`: the person already plays in a squad this season, and a season holds one row per player.

    A RETIRED row is no refusal: the admission rewrites it, whichever team it was on.
    """

    if kader_raw is None or kader_raw.get("inactive_since") is not None:
        return None

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_ALREADY_IN_KADER,
        status=HTTPStatus.CONFLICT,
    )


def find_schon_aufgenommen_refusal(*, gespeichert: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why a key an admission carried onto a squad row is refused: other details, or `registrierung_already_admitted`.

    Never `None`: no registration is left to answer as the first, and a fresh one would register an
    admitted pupil twice.
    """

    if (abweichend := find_abweichender_fingerabdruck_refusal(gespeichert=gespeichert, fingerabdruck=fingerabdruck)) is not None:
        return abweichend

    return WriteRefusal(
        error_code=Code.REGISTRIERUNG_ALREADY_ADMITTED,
        status=HTTPStatus.CONFLICT,
    )


def nummern_im_kader(rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The shirt numbers the live squad wears, compared as stored strings: „07“ is not „7“."""

    return frozenset(nummer for row in rows if isinstance(nummer := row.get("nummer"), str))


def _person_fields(*, registrierung_raw: Mapping[str, Any], adresse: str) -> dict[str, Any]:
    # Here and not in the `spieler` record model, which admits a null forename for the erased pupils'
    # sentinel alone: every person the admission writes passes here, and the administrator's edit
    # requires one by its payload.
    if not person_name_key(registrierung_raw.get("vorname")):
        raise ValueError("a registration carrying no forename names no person")

    return {
        **{field: registrierung_raw[field] for field in (*PERSON_IDENTITY_FIELDS, "geburtsdatum")},
        "email": adresse,
        "inactive_since": None,
    }


def traegt_wahlen(einwilligung: Any) -> bool:
    """Whether a registration's record carries its pupil's choices, which a returning pupil's confirmation never does."""

    return isinstance(einwilligung, Mapping) and "umfang" in einwilligung


def compose_person_update(*, registrierung_raw: Mapping[str, Any], gespeichert: Any, adresse: str) -> Mapping[str, Any]:
    """What an admission writes onto a matched person: the registration's name, address, and what its page asked.

    RENEWED as the new pupil's page promised, each choice only where set later; `gespeichert` is read
    in the admission's transaction.
    """

    fields = _person_fields(registrierung_raw=registrierung_raw, adresse=adresse)
    # Only the sentinel stores a null record, so a matched person holding none is that row or a hand
    # edit: renewing fails on the dotted paths below, and leaving it keeps a person nobody asked.
    if not isinstance(gespeichert, Mapping):
        raise ValueError("a matched person holding no consent record is no person to admit")

    if not traegt_wahlen(registrierung_raw["einwilligung"]):
        # Not one key of the block, its label and day included: they name the last confirmation that
        # asked its choices. Nor the date, the person's own copy,
        # which would undo a correction made since.
        fields.pop("geburtsdatum")

        return {"$set": fields}

    erneuert = compose_erneuert(
        path="einwilligung",
        saved=gespeichert,
        erneuert=registrierung_raw["einwilligung"],
    )

    return {"$set": {**fields, **erneuert}}


def compose_person(*, spieler_id: Any, registrierung_raw: Mapping[str, Any], adresse: str) -> dict[str, Any]:
    """A new person, from the registration alone: its record carried whole, evidence included."""

    fields = _person_fields(registrierung_raw=registrierung_raw, adresse=adresse)

    if not traegt_wahlen(registrierung_raw["einwilligung"]):
        # Refused ahead of every write by `find_person_fehlt_refusal`; reaching here is a caller that skipped it.
        raise ValueError("a returning pupil's registration carries no choice to create a person from")

    return {"_id": spieler_id, **fields, "einwilligung": dict(registrierung_raw["einwilligung"])}


def compose_kader_fields(*, registrierung_raw: Mapping[str, Any], team_id: Any, is_nachnominiert: bool) -> dict[str, Any]:
    """The squad row's fields, written fresh or onto this person's retired row.

    No `rolle`: a registration carries none, and a retired row's captaincy would return to a squad
    that may have given it away.
    """

    fields: dict[str, Any] = {
        "team_id": team_id,
        **{field: registrierung_raw.get(field) for field in ("nummer", "position", "stufe")},
        "rolle": None,
        "is_nachnominiert": is_nachnominiert,
        "inactive_since": None,
    }

    # The key outlives the registration here, so a replay after the admission is still a replay;
    # a keyless registration leaves whatever the row holds.
    for field in ("idempotency_key", "idempotency_fingerprint"):
        if isinstance(registrierung_raw.get(field), str):
            fields[field] = registrierung_raw[field]

    return fields


def compose_ablehnung_update(*, von: str, grund: Any, today: str) -> Mapping[str, Any]:
    return {"$set": {"status": DECLINED, "decision": {"made_at": today, "von": von, "grund": grund}}}


def entscheider_adressen(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every decider these stored registrations name, folded as the ban list is asked."""

    return [
        sign_in_identifier(FLRegistrierungEntscheidung.model_validate(row["decision"]).von) for row in rows if row.get("decision") is not None
    ]


def mit_vorenthaltener_entscheidung(row: Mapping[str, Any], barred: Collection[str]) -> dict[str, Any]:
    """A stored registration with its decision as the list serves it."""

    if row.get("decision") is None:
        return dict(row)

    # As stored first, so a decision the stored shape refuses fails rather than being served withheld.
    entscheidung = FLRegistrierungEntscheidung.model_validate(row["decision"])
    von = withheld_actor(entscheidung.von, barred)

    return {**row, "decision": {**entscheidung.model_dump(), "von": von, "by_barred": von is None}}

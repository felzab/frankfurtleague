"""
API · the registration's judgements, spelled apart from the request

Every predicate here takes values and never a collection or a session: the router does the reading,
so a refusal is judged against what the submission's own transaction can see
(`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments`).
"""

from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

# The application sweep's own date arithmetic and its refusal vocabulary: the two flows count a
# month and read a provider's verdict the same way, and a second spelling would drift from it.
from app.api.bewerbungen.services import (
    ZUSTELLUNG_ABGEWIESEN,
    days_after,
    latest_decision_due,
    one_month_after,
    season_has_ended,
    zustellung_unerreicht_term,
)

# The window predicate is the invite slice's, and `saison_nimmt_registrierungen_an` below answers
# every `laeuft` a link is shown with and this flow's refusal, so a link and the write it opens
# cannot disagree.
from app.api.einladungen.services import registrierungsfenster_laeuft
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungZustand
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.folding import person_name_key
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    LIST_LIMIT_MAX,
    MEDIEN_MIN_AGE_YEARS,
    REGISTRIERUNG_ERINNERUNG_TAGE,
    REGISTRIERUNG_MIN_ALTER_JAHRE,
)

# --- The INVITE's read and the SUBMISSION. Every refusal below is judged before the one write, in
# the order the router asks them in.

# The state a submission arrives in, and the only one it may arrive in: the other is written by the
# decline a later programme builds.
SUBMITTED = "eingereicht"

# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
REGISTRIERUNG_FENSTER_GESCHLOSSEN = "REQ-REGISTRIERUNG-001"
REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN = "REQ-REGISTRIERUNG-002"
REGISTRIERUNG_STUFE_NICHT_ERLAUBT = "REQ-REGISTRIERUNG-003"
REGISTRIERUNG_KADER_VOLL = "REQ-REGISTRIERUNG-008"
# Its own code beside the ban list's own `REQ-SPERRLISTE-001`, which words an administrator's
# duplicate ban: the prefix names the flow that refuses rather than the collection consulted, and
# one rule keeps one code and one German sentence.
REGISTRIERUNG_ADRESSE_GESPERRT = "REQ-REGISTRIERUNG-009"


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
        error_code=REGISTRIERUNG_FENSTER_GESCHLOSSEN,
        status=HTTPStatus.CONFLICT,
        message="this season is not taking registrations today; the registration window is closed",
    )


def find_team_junction_refusal(*, entered: bool) -> WriteRefusal | None:
    """`REQ-REGISTRIERUNG-002`: the season holds no junction row for the invite's team.

    Its own code rather than the squad write's `REQ-SQUAD-001`, which is worded for an
    administrator entering a player: one rule keeps one German sentence.
    """

    if entered:
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN,
        status=HTTPStatus.CONFLICT,
        message="the team this link belongs to does not play that season, so there is no squad to register for",
    )


def find_stufe_refusal(*, stufe: Any, erlaubte_stufen: Sequence[str]) -> WriteRefusal | None:
    """`REQ-REGISTRIERUNG-003`: the season's rules do not offer this Stufe.

    A null passes: the form may leave it unanswered. Refused server-side because
    `docs/backend/spec.md :: I158` protects a STORED row, and nobody has stored this one.
    """

    if stufe is None or stufe in erlaubte_stufen:
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_STUFE_NICHT_ERLAUBT,
        status=HTTPStatus.CONFLICT,
        message="this season does not take registrations for that Stufe; pick one the form offers",
    )


def find_kader_refusal(*, squad_size: int, max_kadergroesse: int) -> WriteRefusal | None:
    """`REQ-REGISTRIERUNG-008`: the squad already stands at the season's cap.

    Over the same two numbers the administrator's Kader editor compares, and asked on every
    submission rather than inside the Nachnominierung period alone, so two writers cannot disagree
    about a full squad.
    """

    if squad_size < max_kadergroesse:
        return None

    # No figure in the message: a stranger holding a link learns nothing about a squad's size.
    return WriteRefusal(
        error_code=REGISTRIERUNG_KADER_VOLL,
        status=HTTPStatus.CONFLICT,
        message="this team's squad is full for that season; ask the team before registering again",
    )


def find_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-REGISTRIERUNG-009`: the ban list holds the address this registration was typed with.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if not gesperrt:
        return None

    # NEUTRAL: an administrator is told plainly what a visitor is told neutrally, so a stranger
    # learns from this that the address is unusable and nothing about a list.
    return WriteRefusal(
        error_code=REGISTRIERUNG_ADRESSE_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this email address cannot be used to register; use another, or ask the league",
    )


def compose_registrierung(
    *,
    saison_id: str,
    team_id: Any,
    einladung_id: Any,
    vorname: str,
    nachname: str,
    email: str,
    position: str | None,
    nummer: str | None,
    stufe: str | None,
    bestaetigung: dict[str, Any],
    today: str,
) -> dict[str, Any]:
    """One pending registration as the submission writes it.

    No late-entry marker of either spelling: it is a fact about the squad entry an admission writes
    weeks later, and one derived here would carry the wrong season's state.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "einladung_id": einladung_id,
        "eingereicht_am": today,
        "status": SUBMITTED,
        "vorname": vorname,
        "nachname": nachname,
        # UNFOLDED -- its domain in punycode and its local part as typed (`docs/backend/spec.md :: I332`)
        # -- where a person's own `email` is folded: the link goes to this address, and the admission
        # folds it onto the person it writes.
        "email": email,
        # Written EXPLICITLY, all three: `required` in the `$jsonSchema` means the key is present,
        # so an omitted null is a validator rejection rather than a stored null.
        "position": position,
        "nummer": nummer,
        "stufe": stufe,
        # Both null until the pupil's own confirmation writes them in one `$set`
        # (`docs/backend/spec.md :: I141`).
        "geburtsdatum": None,
        "einwilligung": None,
        "bestaetigung": bestaetigung,
        # Null until a decline writes it; an admission deletes the row instead.
        "entscheidung": None,
    }


def compose_bestaetigung(*, token_hash: str, today: str, frist: str) -> dict[str, Any]:
    """The confirmation bookkeeping the mint writes: a live hash, mailed today, nobody reminded yet.

    `frist` is stored rather than derived from `verschickt_am` and the bound, so raising the bound
    never moves the deadline of a link already in somebody's inbox.
    """

    return {"token_hash": token_hash, "verschickt_am": today, "erinnert_am": None, "frist": frist}


# --- The SUBMISSION KEY, as the application's submission keeps it
# (`app/api/bewerbungen/services.py :: payload_fingerabdruck`, `docs/backend/spec.md :: I346`).

REGISTRIERUNG_SCHLUESSEL_ABWEICHEND = "REQ-REGISTRIERUNG-011"


def find_abweichender_fingerabdruck_refusal(*, gespeichert: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why this key cannot be replayed, or `None`: it already carries a registration sent with other details.

    Refused rather than answered as the stored one, which would tell the pupil a changed field had
    arrived.
    """

    if gespeichert == fingerabdruck:
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_SCHLUESSEL_ABWEICHEND,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="this submission key already carries a registration sent with other details; the first one stands as it was sent",
    )


def build_wiederholung_filter(*, registrierung_raw: Mapping[str, Any], today: str) -> Mapping[str, Any] | None:
    """The state a replay hands a fresh link in, as its update's filter; `None` where the row holds no live hash.

    Unconfirmed, unreminded and not on record as reached by a mail (`docs/backend/spec.md :: I347`).
    """

    block = registrierung_raw.get("bestaetigung")
    token_hash = block.get("token_hash") if isinstance(block, Mapping) else None
    if not isinstance(token_hash, str):
        return None

    return {
        "_id": registrierung_raw["_id"],
        "status": SUBMITTED,
        "einwilligung.bestaetigt_am": None,
        # The deadline's own day still takes a link, as `link_is_over` reads it.
        "bestaetigung.frist": {"$gte": today},
        "bestaetigung.erinnert_am": None,
        **zustellung_unerreicht_term(pfad="bestaetigung.zustellung"),
    }


def compose_wiederholung_update(*, token_hash: str, bestaetigung: Any) -> Mapping[str, Any]:
    """The replaced hash is kept live rather than voided: a mail that went out unrecorded still holds it.

    Neither `erinnert_am` nor `frist` moves, a replay being neither a reminder nor a re-send.
    """

    block = bestaetigung if isinstance(bestaetigung, Mapping) else {}

    return {"$set": {"bestaetigung.token_hash": token_hash, "bestaetigung.token_hash_zuvor": block.get("token_hash")}}


def registrierung_ist_bestaetigt(*, einwilligung: Any) -> bool:
    """Whether the pupil answered their own link, which is what makes a row admissible.

    Off the consent record's own stamp, never the `bestaetigung` block beside it: that one says a
    message went out rather than that anybody answered.
    """

    return isinstance(einwilligung, Mapping) and bool(einwilligung.get("bestaetigt_am"))


# A reminder's fresh hash and the first mail's, both live, as an application's pair is: a pupil still
# looking at the first message is not punished by the chase.
TOKEN_HASH_FIELDS = ("token_hash", "token_hash_zuvor")

# The admin read's projection, an EXCLUSION for the reason `app/api/bewerbungen/services.py ::
# WITHOUT_TOKEN_HASHES` is one: an inclusion list would restate every field a registration holds.
# Derived from the pair above, so a third hash field cannot reach a read.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {f"bestaetigung.{field}": 0 for field in TOKEN_HASH_FIELDS}


def build_registrierungen_sort(*, sort_by: str, order: str) -> list[tuple[str, int]]:
    """The pending list's order, tie-broken by `_id` in `order`'s OWN direction.

    That direction makes the pair the index's key or its exact inverse; pinned descending,
    `order=asc` would match neither and scan the collection.
    """

    direction = 1 if order == "asc" else -1

    return build_sort(sort_by=sort_by, order=order, chain=(("_id", direction),))


# --- The CONFIRMATION. Every predicate below reads a missing `bestaetigung` block as "nothing to
# confirm".

# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
REGISTRIERUNG_TOKEN_UNKNOWN = "REQ-REGISTRIERUNG-004"
REGISTRIERUNG_TOKEN_EXPIRED = "REQ-REGISTRIERUNG-005"
REGISTRIERUNG_ALREADY_CONFIRMED = "REQ-REGISTRIERUNG-006"
REGISTRIERUNG_ALTER = "REQ-REGISTRIERUNG-007"
REGISTRIERUNG_MEDIEN_ALTER = "REQ-REGISTRIERUNG-010"

# What a pupil's own press records. `volljaehrig` names who spoke and pins no age
# (`docs/glossary.md :: Einwilligung`), so it is the member a sixteen-year-old's own answer takes.
REGISTRIERUNG_ERTEILT_VON: Final = "volljaehrig"


def build_bestaetigung_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Both hash fields, so a reminded pupil's two live links each still open the row.

    No status term: a link reopened on a decided registration shows its own state rather than
    reading as a token nothing knows.
    """

    return {"$or": [{f"bestaetigung.{field}": token_hash} for field in TOKEN_HASH_FIELDS]}


# An INCLUSION, so the rest of a registration -- the surname, the shirt number, the position and the
# Stufe -- is what this base-tier read cannot serve (`docs/backend/spec.md :: READ-CONTACT-001`).

# NEITHER hash is projected: the FILTER above matches on them, and a hash a handler never reads is a
# credential carried through a base-tier request for nothing.
BESTAETIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    "bestaetigung.frist": 1,
    "status": 1,
    "saison_id": 1,
    "team_id": 1,
    "vorname": 1,
    # Both read for the join finding the person the league may already hold, and answered by
    # neither read: the address is an inbox rather than an identity, so the name narrows it.
    "nachname": 1,
    "email": 1,
    "geburtsdatum": 1,
    "einwilligung": 1,
    # Suppressed here alone: only the answer's read below has a patch filter to key on it.
    "_id": 0,
}

# Narrower than the view's: the press judges the link and the stamp, and names no team and no person.
BESTAETIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    "bestaetigung.frist": 1,
    "status": 1,
    "einwilligung.bestaetigt_am": 1,
}


def frist_of(bestaetigung: Any) -> Any:
    return bestaetigung.get("frist") if isinstance(bestaetigung, Mapping) else None


def link_is_over(*, bestaetigung: Any, status: Any, today: str) -> bool:
    """Whether the link is over: the registration was decided, or its deadline has passed."""

    if status != SUBMITTED:
        return True

    # No readable deadline is OVER rather than running: nothing about such a block can say it runs.
    frist = frist_of(bestaetigung)

    # Strictly past, so the deadline's own day still answers: the mail names that day, and a link
    # dying at the midnight before it lies to the person reading the mail.
    return not isinstance(frist, str) or frist < today


def zustand_of(*, registrierung_raw: Mapping[str, Any], today: str) -> FLRegistrierungBestaetigungZustand:
    """What a reopened link shows. A stamp outranks the deadline, so a pupil who answered on the last valid day is shown that they did."""

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return "bestaetigt"

    over = link_is_over(bestaetigung=registrierung_raw.get("bestaetigung"), status=registrierung_raw.get("status"), today=today)

    return "abgelaufen" if over else "gueltig"


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, replaced by a reminder's mint, and swept with the registration: nothing
    tells them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_TOKEN_UNKNOWN,
        status=HTTPStatus.CONFLICT,
        message="this link opens no registration; it may have been replaced by a newer one, or the registration is gone",
    )


def find_expired_token_refusal(*, bestaetigung: Any, status: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the stamp: a registration decided while the link stood open takes no answer either."""

    if not link_is_over(bestaetigung=bestaetigung, status=status, today=today):
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_TOKEN_EXPIRED,
        status=HTTPStatus.CONFLICT,
        message="this link has expired, or the registration has been decided; registering again through the team's link is the way back",
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this registration takes no second answer, or `None`. The single use: the stamp is what spends a link, never a nulled hash."""

    if not registrierung_ist_bestaetigt(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_ALREADY_CONFIRMED,
        status=HTTPStatus.CONFLICT,
        message="this registration has already been confirmed; an answer is given once",
    )


def find_alter_refusal(*, geburtsdatum: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    age = whole_years_between(born=geburtsdatum, today=today)

    # The pupil's own floor and never a contact seat's: raising one must not silently raise the other.
    if age < REGISTRIERUNG_MIN_ALTER_JAHRE:
        return WriteRefusal(
            error_code=REGISTRIERUNG_ALTER,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
            message=f"this consent is given from {REGISTRIERUNG_MIN_ALTER_JAHRE} years of age, and the date entered does not reach it",
        )

    # One ceiling over every consent flow, refusing a mistyped century rather than a real age.
    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return WriteRefusal(
            error_code=REGISTRIERUNG_ALTER,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
            message=f"a date giving an age over {BEWERBUNG_KONTAKT_MAX_AGE_YEARS} years is a mistyped century rather than a birthdate",
        )

    return None


# Which fields say WHO a stored person is, as `app/api/teams/services.py :: SEAT_IDENTITY_FIELDS`
# says it of a contact seat.
PERSON_IDENTITY_FIELDS: tuple[str, ...] = ("vorname", "nachname")


def persons_named(rows: Sequence[Mapping[str, Any]], *, vorname: Any, nachname: Any) -> list[Mapping[str, Any]]:
    """Every row at this address whose stored name is the registration's own.

    An address is NOT an identity: one family mailbox is shared by two pupils
    (`app/core/constraints.py :: SUPPORT_INDEXES`), and joining on it alone shows one the other's
    birthdate.
    """

    # The seat editor's fold (`app/api/teams/services.py :: _identity_of`), so „Weiß“ and „Weiss“ at
    # one family mailbox are two pupils and neither is shown the other's record.
    wanted = tuple(person_name_key(value) for value in (vorname, nachname))

    return [row for row in rows if tuple(person_name_key(row.get(field)) for field in PERSON_IDENTITY_FIELDS) == wanted]


def sole_person(rows: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    """The one person this narrowed set holds, or `None` where it holds several.

    Anything but exactly one row shows the pupil nothing and asks them as a first-timer, which is
    never wrong; guessing is.
    """

    return rows[0] if len(rows) == 1 else None


def answers_shown_back(*, registrierung_raw: Mapping[str, Any], spieler_raw: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Whose birthdate and consent the page presents: this registration's own once confirmed, else the person's the league holds.

    The DOCUMENT rather than the two values: the pair must not be taken from two rows
    (`docs/backend/spec.md :: I141`).
    """

    if registrierung_raw.get("einwilligung") is not None:
        return registrierung_raw

    return spieler_raw if spieler_raw is not None else {}


def find_medien_refusal(*, geburtsdatum: str, medien: bool, today: str) -> WriteRefusal | None:
    """Why this pupil's media consent is refused, or `None`.

    Only a `True` is judged: a `False` publishes nothing, and refusing it would refuse the answer the
    page sends every pupil below the floor.
    """

    if not medien or whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS:
        return None

    return WriteRefusal(
        error_code=REGISTRIERUNG_MEDIEN_ALTER,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
        message=f"a consent to publishing photographs, video and interviews is taken from {MEDIEN_MIN_AGE_YEARS} years of age only",
    )


def compose_confirmation_update(*, geburtsdatum: str, umfang: str, medien: bool, text_version: str, today: str) -> Mapping[str, Any]:
    """The ONE `$set` a confirmation is: the whole consent record beside the date.

    `docs/backend/spec.md :: I141` rests on the two landing together, and between two writes the row
    would hold a birthdate nobody had yet consented to the league keeping.
    """

    return {
        "$set": {
            "geburtsdatum": geburtsdatum,
            # `datum` and `bestaetigt_am` are one day here: the submission stores no record at all,
            # so this press is both the giving of the consent and the confirming of it.
            "einwilligung": {
                "umfang": umfang,
                "erteilt_von": REGISTRIERUNG_ERTEILT_VON,
                "datum": today,
                "bestaetigt_am": today,
                "text_version": text_version,
                "medien": medien,
            },
        }
    }


# --- The retention SWEEP. Each clock is a pure predicate over one document and `today`.

# The other member of the status enum, read by the clock below and written by the decline a later
# programme builds.
DECLINED: Final = "abgelehnt"

# The season key this pass stamps, spelled once: the read that finds a stale season and the update
# that writes the day are one decision, and a rename reaching one of them alone stamps nothing.
REGISTRIERUNG_SWEEP_FELD: Final = "registrierung_sweep_gelaufen_am"


def build_stale_stamp_filter(*, today: str) -> Mapping[str, Any]:
    """Every season this pass has not stamped today.

    Read before the write rather than fanning out unconditionally: `patch_many_in_db` files one log
    row per call, a call matching nothing included, and this pass runs hourly over every season.
    """

    return {REGISTRIERUNG_SWEEP_FELD: {"$ne": today}}


def compose_sweep_stamp(*, today: str) -> Mapping[str, Any]:
    """The whole PASS's day, written on every stale season at once.

    It says when the registration sweep last ran, never when a season was visited.
    """

    return {"$set": {REGISTRIERUNG_SWEEP_FELD: today}}


# One row per PUPIL, so a season's registrations outgrow a page long before its fixtures do
# (`docs/backend/spec.md :: I295`).
SWEEP_PAGE: Final = LIST_LIMIT_MAX

# The consent stamp, at the path a null `einwilligung` and a null stamp both answer: matched against
# null, a missing path matches too, which is what makes one term cover both stored shapes.
_UNBESTAETIGT: Final[Mapping[str, Any]] = {"einwilligung.bestaetigt_am": None}


def build_undecided_filter(*, saison_id: str) -> Mapping[str, Any]:
    """Every submitted row of this season, the clock taking each one once the season is `past`."""

    return {"saison_id": saison_id, "status": SUBMITTED}


def build_unconfirmed_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every submitted, unconfirmed row whose deadline is behind it.

    A comparison matches one BSON type, so a row carrying no readable deadline is never read here --
    and never due either, the predicate refusing exactly that row.
    """

    return {"saison_id": saison_id, "status": SUBMITTED, **_UNBESTAETIGT, "bestaetigung.frist": {"$lt": today}}


def build_erinnerung_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every unchased row at its mark whose last message was not refused.

    `$nin` matches a row carrying no delivery state, which is every fresh mint: the term narrows to
    the refused rather than to the reported.
    """

    return {
        "saison_id": saison_id,
        "status": SUBMITTED,
        **_UNBESTAETIGT,
        "bestaetigung.erinnert_am": None,
        "bestaetigung.frist": {"$gte": today},
        # The mark counted backwards from today, which is the same comparison the predicate makes
        # forwards from the send.
        "bestaetigung.verschickt_am": {"$lte": days_after(day=today, days=-REGISTRIERUNG_ERINNERUNG_TAGE)},
        "bestaetigung.zustellung.stand": {"$nin": sorted(ZUSTELLUNG_ABGEWIESEN)},
    }


def build_decline_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every declined row whose month is behind it, as `decline_erasure_is_due` judges it.

    In the query: a page of decisions still inside their month would fill the read ahead of a due
    one, and the stall refuses the pass.
    """

    return {"saison_id": saison_id, "status": DECLINED, "entscheidung.getroffen_am": {"$lte": latest_decision_due(today=today)}}


def link_is_unreachable(*, bestaetigung: Any) -> bool:
    """Whether the provider refused the last message this link went out in.

    A registration gets ONE chase, and spending it on an address known to reject it spends it on
    nobody; registering again is what writes a fresh row.
    """

    zustellung = bestaetigung.get("zustellung") if isinstance(bestaetigung, Mapping) else None

    return isinstance(zustellung, Mapping) and zustellung.get("stand") in ZUSTELLUNG_ABGEWIESEN


def erinnerung_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether this registration's one reminder is owed today.

    Submitted, unconfirmed, never reminded, inside its deadline and reachable. A row past its
    `frist` is chased by nothing: a link minted on the way out is one nobody can spend.
    """

    if registrierung_raw.get("status") != SUBMITTED:
        return False

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return False

    bestaetigung = registrierung_raw.get("bestaetigung")
    if not isinstance(bestaetigung, Mapping) or bestaetigung.get("erinnert_am") is not None:
        return False

    verschickt_am, frist = bestaetigung.get("verschickt_am"), bestaetigung.get("frist")
    if not isinstance(verschickt_am, str) or not isinstance(frist, str) or frist < today:
        return False

    if link_is_unreachable(bestaetigung=bestaetigung):
        return False

    return days_after(day=verschickt_am, days=REGISTRIERUNG_ERINNERUNG_TAGE) <= today


def bestaetigung_erasure_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the deadline clock takes this registration, strictly past its `frist`.

    STRICTLY, because the link still answers on the deadline's own day. No notice goes out either
    way (`docs/backend/spec.md :: I290`).
    """

    if registrierung_raw.get("status") != SUBMITTED:
        return False

    if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
        return False

    frist = frist_of(registrierung_raw.get("bestaetigung"))

    return isinstance(frist, str) and frist < today


def undecided_erasure_is_due(*, registrierung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this registration.

    Whatever the pupil answered and whether or not a message could reach them: no admission can be
    taken for a season that is over (`docs/backend/spec.md :: I292`).
    """

    return registrierung_raw.get("status") == SUBMITTED and season_has_ended(saison_status=saison_status)


def decline_erasure_is_due(*, registrierung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the one-month clock takes this declined registration, counted from the day the decision was taken."""

    if registrierung_raw.get("status") != DECLINED:
        return False

    entscheidung = registrierung_raw.get("entscheidung")
    getroffen_am = entscheidung.get("getroffen_am") if isinstance(entscheidung, Mapping) else None

    return isinstance(getroffen_am, str) and one_month_after(day=getroffen_am) <= today


def compose_erinnerung_update(*, token_hash: str, bestaetigung: Any, today: str) -> Mapping[str, Any]:
    """The reminder's ONE `$set`: the stamp and the fresh hash, the first kept live beside it.

    `verschickt_am` and `frist` stay: a reminder is not a re-send
    (`docs/backend/spec.md :: I152`).
    """

    block = bestaetigung if isinstance(bestaetigung, Mapping) else {}

    return {
        "$set": {
            "bestaetigung.token_hash": token_hash,
            "bestaetigung.token_hash_zuvor": block.get("token_hash"),
            "bestaetigung.erinnert_am": today,
        }
    }

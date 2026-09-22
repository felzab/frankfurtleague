from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, TypeAdapter

# The delivery state is the application slice's declaration, stored at every home the register names
# (`app/api/zustellung/services.py :: ZIEL_PFADE`).
from app.api.bewerbungen.schemas import FLBewerbungZustellung
from app.api.saisons.schemas import FLSaisonStatus
from app.api.spieler.schemas import SQUAD_NUMMER_PATTERN, FLEinwilligung, FLSpielerPosition, FLSpielerStufe
from app.shared.schemas.bounds import (
    BEWERBUNG_TOKEN_MAX_LENGTH,
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    KONTAKT_EMAIL_MAX_LENGTH,
    KONTAKT_NAME_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
)
from app.shared.schemas.custom import (
    PERSON_NAME_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
)
from app.shared.schemas.responses import BaseAPIResponse

# --- The INVITE's read, the SUBMISSION and the administrator's read of what it stored. Every
# payload below is reached from a request body alone, so each forbids an undeclared key; the read
# models stay lax (`docs/backend/spec.md :: I49`).

# TWO members and not three: an admission deletes the row, its content having become the person and
# the squad row, so a state naming an admitted registration would be one no document is ever read in.
FLRegistrierungStatus = Literal["eingereicht", "abgelehnt"]

# One key, and it is the one the collection's queue index sorts on: rows arrive from a public form
# and a second order would plan a blocking sort over a list nothing bounds.
FLRegistrierungenSortOptions = Literal["eingereicht_am"]

# Stripped, a token pasted from a mail client arriving with a trailing space more often than not.
# `BEWERBUNG_TOKEN_MAX_LENGTH` and not a bound of its own: one `mint_token` spells every link this
# application hands out.
CustomRegistrierungToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_TOKEN_MAX_LENGTH)]


class FLRegistrierungBestaetigung(BaseModel):
    """One registration's confirmation bookkeeping as an administrator reads it -- and NO `token_hash`.

    The hash is a raw document key the confirmation query alone reads, as
    `app/api/bewerbungen/schemas.py :: FLBewerbungBestaetigung` keeps its own off the wire.
    """

    verschickt_am: CustomDateString
    erinnert_am: CustomOptionalDateString
    # Stored beside the send rather than derived from it: raising the bound would otherwise move the
    # deadline of every link already in somebody's inbox.
    frist: CustomDateString
    # Null on every fresh mint: nothing is yet known about the message that link went out in.
    zustellung: FLBewerbungZustellung | None = None


class FLRegistrierungEntscheidung(BaseModel):
    """Who declined this registration, when, and why.

    Its own model beside the application's: one shape over both would let a field either flow adds
    reach the other, where a pupil's record and a school's are decided by different surfaces.
    """

    getroffen_am: CustomDateString
    von: CustomNonEmptyString
    grund: str | None


class FLRegistrierung(BaseModel):
    """One pupil's registration for one team's season, as it is stored.

    The submission is never rewritten: the pupil's own confirmation fills `geburtsdatum` and
    `einwilligung`, and a decline writes `status` and `entscheidung`.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    team_id: CustomObjectId
    # The invite the token opened, so a row can be read back to the link that produced it after that
    # link has been revoked and replaced.
    einladung_id: CustomObjectId
    eingereicht_am: CustomDateString
    status: FLRegistrierungStatus
    vorname: CustomNonEmptyString
    nachname: CustomNonEmptyString
    # AS TYPED, where a person's own `email` is stored folded: the address is what the confirmation
    # link was mailed to, and the admission is what folds it onto the person it writes.
    email: CustomNonEmptyString
    # The three a squad often does not know at registration, each stated by the caller rather than
    # defaulted. Unbounded on read, as every stored value here is (`docs/backend/spec.md :: I254`).
    position: FLSpielerPosition | None
    nummer: str | None
    stufe: FLSpielerStufe | None
    # Null until the pupil confirms, which is the pairing `docs/backend/spec.md :: I141` rests on.
    geburtsdatum: CustomOptionalDateString
    einwilligung: FLEinwilligung | None
    bestaetigung: FLRegistrierungBestaetigung | None
    entscheidung: FLRegistrierungEntscheidung | None
    # Composed by the read rather than left to a consumer to derive from `einwilligung`: no
    # unconfirmed registration may be admitted, and two readers deriving that differently is how an
    # unconfirmed pupil gets a squad row.
    bestaetigt: bool


FLRegistrierungListAdapter = TypeAdapter(list[FLRegistrierung])


class FLEinladungAnsichtPayload(BaseModel):
    """The link a visitor presents, and nothing else: the row it opens says which team and season it is for."""

    model_config = ConfigDict(extra="forbid")

    token: CustomRegistrierungToken


class FLEinladungAnsichtResponse(BaseAPIResponse):
    """What an invite's holder is told before they type anything.

    Each field is something the link's own message already said, or something the form is bounded
    by: a select offering more than the write accepts is a drifted client.
    """

    team: CustomNonEmptyString
    # The club's `full_name`, a club here BEING a school: the consent copy names it, and a slot with
    # no value renders as a hole in a consent text.
    schule: CustomNonEmptyString
    saison_id: str
    saison_status: FLSaisonStatus
    laeuft: bool
    erlaubte_stufen: list[FLSpielerStufe]
    # Whether the season holds the invite's team at all. False is a state the page words rather than
    # a form to fill in: every submission through it meets `REQ-REGISTRIERUNG-002`.
    team_eingetragen: bool
    # Whether the squad has room today. The write asks again: this answer is a form's, and two
    # submissions for one remaining place both pass it.
    kader_frei: bool
    nachnominierung: bool


class FLPostRegistrierungPayload(BaseModel):
    """One pupil registering through a team's link.

    The league's own fields -- the team, the season, the state, the deadline and the confirmation
    link -- are taken off the invite and the clock, never off this body.
    """

    model_config = ConfigDict(extra="forbid")

    token: CustomRegistrierungToken
    # Stripped first, so the padding the pattern's trailing space class admits is never stored and
    # never printed on a squad sheet. Both ceilings are the application form's, so a name refused
    # there is refused here.
    vorname: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=KONTAKT_NAME_MAX_LENGTH, pattern=PERSON_NAME_PATTERN)
    ]
    nachname: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=KONTAKT_NAME_MAX_LENGTH, pattern=PERSON_NAME_PATTERN)
    ]
    # The ceiling is stated rather than left to email-validator, whose refusal names no field.
    email: Annotated[EmailStr, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH)]
    # Each NULLABLE with the caller stating the null rather than omitting it, as a squad payload's
    # three are: the answer is then the pupil's and not a default nobody chose.
    position: FLSpielerPosition | None
    # Tightened on the WRITE side alone, as a squad row's is.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)
    stufe: FLSpielerStufe | None


class FLPostRegistrierungResponse(BaseAPIResponse):
    """The stored registration and the raw confirmation link, answered here and never again.

    The database holds its hash alone, so a lost link is re-minted by the sweep's reminder rather
    than recovered from any read.
    """

    registrierung_id: CustomObjectId
    bestaetigung_token: CustomNonEmptyString
    frist: CustomDateString
    # Both off the invite the token opened, so the confirmation mail addresses the pupil by their
    # team and season without taking either from a body anyone holding the link could type.
    team: CustomNonEmptyString
    saison_id: str
    # Echoed so the page can name the address the link went to, which is what a pupil checks when no
    # mail arrives.
    email: CustomNonEmptyString


class FLRegistrierungenFilterParams(BaseModel):
    """What the pending list may narrow on."""

    saison_id: Annotated[str, StringConstraints(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)] | None = None
    team_id: CustomObjectId | None = None
    # ONE value rather than a list: this read is opened per team and season, where the application
    # triage's multi-select answers a queue spanning both.
    status: FLRegistrierungStatus | None = None
    # Bounded on BOTH sides and no null sentinel, as the application queue's is: an anonymous party
    # writes these rows, so the cap holds a caller naming more rather than obeying it.
    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: FLRegistrierungenSortOptions = Field(default="eingereicht_am")
    order: Literal["asc", "desc"] = Field(default="desc")


class FLRegistrierungenListResponse(BaseAPIResponse):
    """The pending rows, newest first, and whether that is the whole of them."""

    registrierungen: list[FLRegistrierung]
    # German, unlike the envelope fields around it, for the reason the application queue's is: this
    # flag decides whether an administrator may trust the list.
    vollstaendig: bool


# --- The CONFIRMATION. The token is the whole credential, as it is for the application's link, so
# both endpoints are base-tier and every payload forbids an undeclared key.

# What a pupil answers about publication. An alias where `app/api/spieler/schemas.py ::
# FLEinwilligung` inlines its own: the view, the payload and the answer all take it, and two
# spellings would let the page offer a scope the write refuses.
FLRegistrierungUmfang = Literal["kader_oeffentlich", "intern"]

# What a reopened link shows. The page's own `ungueltig` and `unlesbar` are not here: a token
# nothing opens is a refusal rather than a state, and an unreadable one never reached the backend.
FLRegistrierungBestaetigungZustand = Literal["gueltig", "bestaetigt", "abgelaufen"]


class FLRegistrierungBestaetigungAnsichtPayload(BaseModel):
    """A POST that reads: the token travels in a body, never in a second URL."""

    model_config = ConfigDict(extra="forbid")

    token: CustomRegistrierungToken


class FLRegistrierungBestaetigungAnsichtResponse(BaseAPIResponse):
    """What one confirmation link opens, and no eleventh field (`docs/backend/spec.md :: I286`)."""

    zustand: FLRegistrierungBestaetigungZustand
    # The club's short name and its own `full_name`, a club here BEING a school: the ruled consent
    # text renders both, and a slot with no value renders as a hole in it.
    team: CustomNonEmptyString
    schule: CustomNonEmptyString
    saison_id: str
    vorname: CustomNonEmptyString
    # The wording the stored record cites, so a reopened link names the version answered under
    # rather than the one the page would stamp today.
    text_version: CustomOptionalString
    # Served rather than read from a constant of the page's own: the floor the write judges by is
    # the one the paragraph a pupil reads before consenting has to state.
    mindestalter: int
    # All three null where the league holds no record for this person, and null where one address
    # stands behind several, whom this read cannot tell apart.
    geburtsdatum: CustomOptionalDateString
    umfang: FLRegistrierungUmfang | None
    # Null is "nobody has answered" and never "off", which the page paints either way: a stored
    # `True` re-presented as off would re-ask a consent already given.
    medien: bool | None


class FLRegistrierungBestaetigungPayload(BaseModel):
    """One pupil's own answer: their date of birth, and the two consents that stand under one record."""

    model_config = ConfigDict(extra="forbid")

    token: CustomRegistrierungToken
    # Unbounded here -- the age is a 409 carrying its own code, never a 422, so the page marks its
    # one field and keeps the date the pupil typed.
    geburtsdatum: CustomDateString
    umfang: FLRegistrierungUmfang
    # Required rather than defaulted: a page omitting it would store this model's answer in place of
    # the person's, and an off switch is an answer.
    medien: bool
    # The label the ROUTE HANDLER stamped and never one the browser composed
    # (`docs/frontend/spec.md :: I148`).
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]


class FLRegistrierungBestaetigungResponse(BaseAPIResponse):
    """What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time."""

    # One member: this page has no Widerspruch door. A pupil who does not want to be registered lets
    # the link expire, and the sweep takes the row.
    ergebnis: Literal["bestaetigt"]
    geburtsdatum: CustomDateString
    umfang: FLRegistrierungUmfang
    medien: bool


# --- The retention SWEEP, system tier. The backend decides and erases, the frontend mails: what
# leaves here is what one note needs and nothing a pupil's record holds beyond it.


class FLRegistrierungSweepErinnerung(BaseModel):
    """One reminder to send: a pupil whose link has reached its reminder age and who has not answered it.

    The token is the RAW fresh one (`docs/backend/spec.md :: I296`).
    """

    registrierung_id: CustomObjectId
    saison_id: str
    # Empty where the team row is gone, as the application sweep's `schule` is: a message naming no
    # team is worth more than a pass that stops.
    team: str
    vorname: CustomNonEmptyString
    email: CustomNonEmptyString
    # No deadline: the message names the window in days from the mirrored bound rather than a date,
    # so a chase cannot state a day the stored one has moved away from.
    token: CustomNonEmptyString


class FLRegistrierungSweepBenachrichtigung(BaseModel):
    """One pupil whose confirmed registration was erased at its season's end, and who is told after the fact.

    No token and no deadline: the row is gone, and this message asks for nothing.
    """

    registrierung_id: CustomObjectId
    saison_id: str
    team: str
    vorname: CustomNonEmptyString
    email: CustomNonEmptyString


class FLRegistrierungSweepResponse(BaseAPIResponse):
    """One season's pass: the reminders already stamped, the erasures already made, and the one note each of them owes.

    The ordering that makes those three true is `docs/backend/spec.md :: I297`.
    """

    saison_id: str
    erinnerungen: list[FLRegistrierungSweepErinnerung]
    # Counted apart from the erasures below and never derived from them: an unconfirmed row is told
    # neither before nor after, so a caller mailing every erasure would write to an address the
    # league never confirmed.
    benachrichtigt: list[FLRegistrierungSweepBenachrichtigung]
    geloescht_unbestaetigt: int
    geloescht_ohne_entscheidung: int
    geloescht_abgelehnt: int
    redigierte_aktionen: int

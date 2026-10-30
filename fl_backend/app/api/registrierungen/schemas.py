from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

from app.api.spieler.schemas import SQUAD_NUMMER_PATTERN, FLEinwilligung
from app.shared.schemas.bestaetigung import CustomToken, FLBestaetigung
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
)
from app.shared.schemas.einwilligung import CustomEinwilligungTextVersion, FLEinwilligungNachweise, FLEinwilligungStand
from app.shared.schemas.kontakt import CustomEmail, CustomKontaktName
from app.shared.schemas.literals import (
    FLBestaetigungZustand,
    FLEinwilligungUmfang,
    FLRegistrierungStatus,
    FLSaisonStatus,
    FLSortOrder,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# --- The INVITE's read, the SUBMISSION and the administrator's read of what it stored. Every
# payload below is reached from a request body alone, so each forbids an undeclared key; the read
# models stay lax.

# One key, and it is the one the collection's queue index sorts on: rows arrive from a public form
# and a second order would plan a blocking sort over a list nothing bounds.
FLRegistrierungenSortOptions = Literal["eingereicht_am"]


class FLRegistrierungEntscheidung(BaseModel):
    """Who declined this registration, when, and why."""

    getroffen_am: CustomDateString
    von: CustomNonEmptyString
    grund: str | None


class FLRegistrierungEntscheidungZeile(FLRegistrierungEntscheidung):
    """A decision as the list serves it: the stored one, its decider withheld where the ban list holds that address."""

    # Null exactly where `von_gesperrt` is set, as the grants list withholds its actors.
    von: CustomNonEmptyString | None
    von_gesperrt: bool


class FLRegistrierungEinwilligung(FLEinwilligung, BaseReadModel):
    """A pending registration's consent record, each choice and `datum` optional here alone.

    A returning pupil's page asks no choice.
    """

    umfang: FLEinwilligungUmfang | None = None
    datum: CustomOptionalDateString = None
    # Null where nobody was asked, never `False`: a returning pupil's media answer stands on their own record.
    medien: bool | None = None
    # Empty on a returning pupil's record, which evidences no choice it never asked.
    nachweis: FLEinwilligungNachweise = Field(default_factory=FLEinwilligungNachweise)


class _RegistrierungStored(BaseModel):
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
    email: CustomNonEmptyString
    # The three a squad often does not know at registration, each stated by the caller rather than
    # defaulted.
    position: FLSpielerPosition | None
    # Patterned on the submission's payload alone.
    nummer: str | None
    stufe: FLSpielerStufe | None
    # Null until the pupil confirms.
    geburtsdatum: CustomOptionalDateString
    einwilligung: FLRegistrierungEinwilligung | None


class FLRegistrierung(_RegistrierungStored):
    """One pupil's registration for one team's season, as stored, its decision as served.

    Its pupil fills and withdraws `einwilligung` and fills `geburtsdatum`; a decline writes `status` and `entscheidung`.
    """

    bestaetigung: FLBestaetigung | None
    # As served, so a row reaches the wire only through
    # `app/api/registrierungen/services.py :: mit_vorenthaltener_entscheidung`.
    entscheidung: FLRegistrierungEntscheidungZeile | None
    # Composed by the read rather than left to a consumer to derive from `einwilligung`: no
    # unconfirmed registration may be admitted, and two readers deriving that differently is how an
    # unconfirmed pupil gets a squad row.
    bestaetigt: bool


class FLRegistrierungBestaetigungRecord(FLBestaetigung):
    """One registration's bookkeeping as `registrierungen` stores it: the hash of every link it was mailed, each live."""

    token_hashes: list[str]


class FLRegistrierungRecord(_RegistrierungStored):
    """One registration as `registrierungen` stores it: its decision before any decider is withheld, and what no read serves."""

    bestaetigung: FLRegistrierungBestaetigungRecord | None
    entscheidung: FLRegistrierungEntscheidung | None
    # The submission's replay key and digest.
    idempotenz_schluessel: str | None = None
    idempotenz_fingerabdruck: str | None = None


FLRegistrierungListAdapter = TypeAdapter(list[FLRegistrierung])


class FLEinladungAnsichtResponse(BaseAPIResponse):
    """What an invite's holder is told before they type anything, and the bounds the form is held to."""

    team: CustomNonEmptyString
    # The club's `full_name`, a club here BEING a school: the consent copy names it, and a slot with
    # no value renders as a hole in a consent text.
    schule: CustomNonEmptyString
    saison_id: str
    saison_status: FLSaisonStatus
    laeuft: bool
    erlaubte_stufen: list[FLSpielerStufe]
    # Whether the season holds the invite's team at all. False is a state the page words rather than
    # a form to fill in: every submission through it meets `registrierung_geschlossen`.
    team_eingetragen: bool
    # Whether the squad has room today. The write asks again: this answer is a form's, and two
    # submissions for one remaining place both pass it.
    kader_frei: bool
    nachnominierung: bool


class FLPostRegistrierungPayload(BaseModel):
    """One pupil registering through a team's link.

    The team, the season, the state, the deadline and the confirmation link come from the invite and the clock, never from this body.
    """

    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    vorname: CustomKontaktName
    nachname: CustomKontaktName
    email: CustomEmail
    # Each NULLABLE with the caller stating the null rather than omitting it, as a squad payload's
    # three are: the answer is then the pupil's and not a default nobody chose.
    position: FLSpielerPosition | None
    # Tightened on the WRITE side alone, as a squad row's is.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)
    stufe: FLSpielerStufe | None


class FLPostRegistrierungResponse(BaseAPIResponse):
    """The stored registration, the one a replayed key wrote first; its confirmation mail is owed in the same write."""

    registrierung_id: CustomObjectId


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
    order: FLSortOrder = Field(default="desc")


class FLRegistrierungenListResponse(BaseAPIResponse):
    """The pending rows, newest first, and whether that is the whole of them."""

    registrierungen: list[FLRegistrierung]
    # German, unlike the envelope fields around it, for the reason the application queue's is: this
    # flag decides whether an administrator may trust the list.
    vollstaendig: bool


# --- The CONFIRMATION. The token is the whole credential, as it is for the application's link, so
# both endpoints are base-tier and every payload forbids an undeclared key.

# The two pages one link may open, members of `app/shared/einwilligung.py :: Seite`: the returning
# pupil's asks no choice, so the press is judged against whichever its own transaction resolves.
FLRegistrierungSeite = Literal["bestaetigung_spieler", "bestaetigung_spieler_wiederkehrend"]


class FLRegistrierungBestaetigungAnsichtResponse(BaseAPIResponse):
    """What one confirmation link opens, and no field past the ones declared here."""

    zustand: FLBestaetigungZustand
    # The club's short name and its own `full_name`, a club here BEING a school: the ruled consent
    # text renders both, and a slot with no value renders as a hole in it.
    team: CustomNonEmptyString
    schule: CustomNonEmptyString
    saison_id: str
    # Served rather than left to the page to infer: the press refuses the other page's label, and the
    # returning pupil's takes the stored person's birthdate rather than asking one.
    seite: FLRegistrierungSeite
    # Served rather than read from a constant of the page's own: the floor the write judges by is
    # the one the paragraph a pupil reads before consenting has to state.
    mindestalter: int
    # The age the media answer is judged by, served for `mindestalter`'s reason: the page offers the
    # switch only from it, and a copy of its own would offer it where the write refuses.
    medien_mindestalter: int = Field(gt=0)


class FLRegistrierungBestaetigungPayload(BaseModel):
    """One pupil's own answer: their date of birth where the page asks it, and on the new pupil's page the two consents."""

    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    # Unbounded: the age is a 422 with its own code, never a `payload_refused`, so the page marks its one
    # field and keeps the typed date. Null where a stored one is taken, and required for `umfang`'s reason.
    geburtsdatum: CustomOptionalDateString
    # Both set on the new pupil's page and both null on the returning pupil's (`registrierung_wahlen_unpassend`).
    # Required rather than defaulted: a page omitting one would store this model's answer in place of
    # the person's.
    umfang: FLEinwilligungUmfang | None
    medien: bool | None
    # The label of the words the page showed: the write refuses any but the running one.
    text_version: CustomEinwilligungTextVersion


class FLRegistrierungBestaetigungResponse(BaseAPIResponse):
    """What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time."""

    # One member: this page has no Widerspruch door. A pupil who does not want to be registered lets
    # the link expire, and the sweep takes the row.
    ergebnis: Literal["bestaetigt"]
    # Null where the press posted none, the stored date standing: an echo of it would serve it.
    geburtsdatum: CustomOptionalDateString
    # Null on a returning pupil's press, which posted none.
    umfang: FLEinwilligungUmfang | None
    medien: bool | None


# --- The pupil's own WITHDRAWAL on the account page, between the confirmation and the admission.


class FLRegistrierungKontoEinwilligungResponse(BaseAPIResponse):
    """The registration's consent record as it stands after the write, everything the pupil did not move unchanged."""

    registrierung_id: CustomObjectId
    einwilligung: FLRegistrierungEinwilligung
    # For `app/api/spieler/schemas.py :: FLSpielerKontoEinwilligungResponse`'s reason.
    nachweis_stand: FLEinwilligungStand


# --- The retention SWEEP, system tier. The backend decides, erases and owes each reminder in the
# Postausgang; nothing a pupil's record holds leaves here.


class FLRegistrierungSweepResponse(BaseAPIResponse):
    """One season's pass: the reminders owed and the erasures made, each committed."""

    saison_id: str
    erinnert: int
    geloescht_unbestaetigt: int
    geloescht_ohne_entscheidung: int
    geloescht_abgelehnt: int
    redigierte_aktionen: int
    # One sum over every clock rather than a count a clock: the line logging each row names its clock.
    fehlgeschlagen: int


# --- The TEAM's decision, person tier. No model below declares `email`, `telefon`, `geburtsdatum` or
# `einwilligung`: a seat holder reads who registered and decides, and a pupil's address and birthdate
# are the league administrators' alone (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`).


class FLOffeneRegistrierungenParams(BaseModel):
    """The pending list's direction and page, so a flooded queue's oldest rows stay reachable."""

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    order: FLSortOrder = Field(default="desc")


class FLRegistrierungPerson(BaseModel):
    """The stored person a confirmed registration's address resolves to, named so the team can be asked whether it is the same one."""

    spieler_id: CustomObjectId
    vorname: CustomNonEmptyString
    nachname: str | None
    # A flag and never the two values: the stored birthdate is shown to administrators alone, and
    # the question needs only that something differs.
    weicht_ab: bool


class FLOffeneRegistrierung(BaseModel):
    """One pending registration as the team deciding it reads it."""

    registrierung_id: CustomObjectId
    eingereicht_am: CustomDateString
    vorname: CustomNonEmptyString
    nachname: CustomNonEmptyString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # Whether the pupil answered their own link, which is what makes the row one the team may admit.
    aufnehmbar: bool
    nummer_doppelt: bool
    # Empty on an unconfirmed row: its address is unproven, and resolving it would show the team
    # whoever stands behind an address anybody typed into the form.
    person: FLRegistrierungPerson | None


class FLOffeneRegistrierungenResponse(BaseAPIResponse):
    """One team's pending registrations for one season, and whether that is the whole of them."""

    team_id: CustomObjectId
    saison_id: str
    registrierungen: list[FLOffeneRegistrierung]
    vollstaendig: bool


class FLRegistrierungAufnehmenPayload(BaseModel):
    """The team's answer to the question the read asked: the person this registration is admitted into, or none."""

    model_config = ConfigDict(extra="forbid")

    # REQUIRED with no default: a client that omitted it would be read as answering "a new person",
    # which is the one answer that can put a returning pupil into the league twice.
    spieler_id: CustomObjectId | None


class FLRegistrierungAufnahmeResponse(BaseAPIResponse):
    """The squad entry the admission wrote, and the person it belongs to."""

    # The admitted registration's id, deleted with it, so a caller can drop the row it pressed.
    registrierung_id: CustomObjectId
    spieler_id: CustomObjectId
    team_id: CustomObjectId
    saison_id: str
    vorname: CustomNonEmptyString
    nachname: CustomNonEmptyString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    ist_nachnominiert: bool


# One member, and never free text: the reason reaches the pupil's mail, and a team's own words about
# a pupil would be personal data the league then holds about them.
FLRegistrierungAblehnungsgrund = Literal["andere_person"]


class FLRegistrierungAblehnenPayload(BaseModel):
    """Why the team declines, from a closed set or not at all."""

    model_config = ConfigDict(extra="forbid")

    # Required, for `FLRegistrierungAufnehmenPayload.spieler_id`'s reason: the reason picks the
    # sentence the pupil is mailed.
    grund: FLRegistrierungAblehnungsgrund | None


class FLRegistrierungAblehnungResponse(BaseAPIResponse):
    """The declined registration, and the first name the seat holder is told the decision by."""

    registrierung_id: CustomObjectId
    vorname: CustomNonEmptyString

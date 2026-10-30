"""The value lists more than one slice reads, each published once as its own schema in the document.

`type` statements rather than plain assignments: Pydantic publishes a named alias as one component that
every field referencing it points at, where a plain alias is inlined into each. `typing.get_args` returns
`()` for one of these, so a reader takes the values from `X.__value__`.
"""

from typing import Final, Literal, get_args

# --- Sorting

type FLSortOrder = Literal["asc", "desc"]

# --- The season and its fixtures

type FLSaisonStatus = Literal["past", "active", "future"]

type FLSaisonPhase = Literal["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]

# Spelled rather than derived: a `Literal`'s members must be literal expressions for a type checker to read
# them, so widening the set is arithmetic rather than a choice.
type FLGruppenNames = Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]

# The two sides of one fixture, as its document's fields name them.
type FLSpielSeite = Literal["team1", "team2"]

# What happened to a fixture beyond being played. Nullable rather than total where a fixture carries it:
# `null` is "nothing to say", so no read site spells an ordinary fixture out.
type FLSonderereignis = Literal["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]

# A withdrawal is not a sanction, so the two routes out of a season are told apart rather than both filed
# as one.
type FLAustrittType = Literal["disqualifikation", "rueckzug"]

# --- The club

# Slugs rather than the German the league's CI document spells, for the reason
# `app/api/spieler/schemas.py :: FLSpielerRolle` gives.
type FLSchulform = Literal["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]

# The league's kit palette, slugged for `FLSchulform`'s reason. A slug is never renamed or dropped: stored
# rows and the action log's images hold it.
type FLTrikotFarbe = Literal[
    "schwarz",
    "weiss",
    "grau",
    "braun",
    "bordeaux",
    "rot",
    "koralle",
    "orange",
    "gold",
    "gelb",
    "limette",
    "hellgruen",
    "gruen",
    "smaragd",
    "tuerkis",
    "cyan",
    "hellblau",
    "meerblau",
    "blau",
    "dunkelblau",
    "flieder",
    "violett",
    "magenta",
    "rosa",
]

# --- The contact seats

# The three seats as a closed set, in the order `app/api/teams/schemas.py :: FLSaisonTeamKontakte` declares
# them.
type FLKontaktRolle = Literal["trainer", "ansprechperson", "stellvertretung"]

# The one spelling of the seat set every module iterates, so a fourth seat is added in one place.
KONTAKT_ROLLEN: Final[tuple[FLKontaktRolle, ...]] = get_args(FLKontaktRolle.__value__)

# Which second seat one person may hold beside the Trainer's. A closed set rather than a flag per seat: the
# two are alternatives, and nothing can mean holding both.
type FLTrainerZugleich = Literal["ansprechperson", "stellvertretung"]

# A season row as a link minted on it sees it: open, or closed by its season ending, which outranks its
# team having left it.
type FLKontaktZeile = Literal["offen", "saison_vorbei", "ausgetreten"]

# Wider than the administrative payload's: the WhatsApp scope is the person's own, set on their
# confirmation page and moved by their account page's seat PATCH; an administrator's payload offering it
# would transcribe one.
type FLKontaktKenntnisnahmeUmfang = Literal["kontaktdaten", "kontaktdaten_whatsapp"]

# Who put this person in the seat: the applicant on the form, or the league's administration (a reseat,
# the contacts editor). Not `verwaltung`, the access tier's word (`docs/glossary.md :: verwaltung`).
type FLKontaktEingetragenVon = Literal["bewerbung", "liga"]

# --- The pupils

# In the order a squad sheet lists them. `sort_by="position"` sorts the STRING, so a public squad list is
# alphabetical instead.
type FLSpielerPosition = Literal["Tor", "Abwehr", "Mittelfeld", "Angriff"]

# The Hessen Oberstufe, both phases. E2 is offered although no row holds it: a set stopping at what a
# season contains would refuse an entry as the year turns.
type FLSpielerStufe = Literal["E1", "E2", "Q1", "Q2", "Q3", "Q4"]

# What a pupil or a referee agreed may be published about them.
type FLEinwilligungUmfang = Literal["kader_oeffentlich", "intern"]

# TWO members and not three: an admission deletes the row, its content having become the person and the
# squad row, so a state naming an admitted registration would be one no document is ever read in.
type FLRegistrierungStatus = Literal["eingereicht", "abgelehnt"]

# --- A person's own link

# What a reopened confirmation link shows. A token nothing opens is a refusal rather than a state, and an
# unreadable one never reaches the backend. `gesperrt` ranks first.
type FLBestaetigungZustand = Literal["gueltig", "bestaetigt", "abgelaufen", "gesperrt"]

# --- The Verwaltung and an address's change

# `owner` holds every power `administration` does and is reached only by an owner's tier change, never by
# a grant.
type FLVerwaltung = Literal["owner", "administration"]

# Why an administrator may not approve an act on a grant: their own address, their own start, an owner's
# act without an owner's power, or a grant or tier younger than the request.
type FLGenehmigungVerwehrt = Literal["eigene", "gestartet", "inhaber", "juenger"]

# How an address change takes effect: the person's own start, an administrator's the address on file
# approves, or an administrator's with a recorded reason, waiting after its confirmation.
type FLAdresswechselWeg = Literal["konto", "freigabe", "wartezeit"]

# Why the address tool refuses this reader an address's change, served beside every id a page links into
# it: `eigene` their own address, `verwaltung` a grant holder's without an owner's power.
type FLAdresswechselEinsehbarVerwehrt = Literal["eigene", "verwaltung"]

# What the change waits on: the address on file's approval, the new mailbox's link, another
# administrator's approval of a grant's move once the new mailbox confirmed, or its waiting time.
type FLAdresswechselWartetAuf = Literal["freigabe", "neue_adresse", "genehmigung", "wartezeit"]

# How a change ended. `verworfen` is every discard: an administrator's, the pass's refusal when due,
# nothing left to move, and an erasure's.
type FLAdresswechselEndeArt = Literal["wirksam", "abgelehnt", "gestoppt", "abgelaufen", "ersetzt", "verworfen"]

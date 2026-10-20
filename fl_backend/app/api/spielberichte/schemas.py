from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from app.api.berechtigungen.schemas import FLUtcInstant
from app.api.spiele.schemas import SONDEREREIGNIS_NO_SHOW, FLSaisonPhase, FLSonderereignis, FLSpielElfmeterschiessen
from app.shared.schemas.bounds import SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH, SPIELBERICHT_EINTRAEGE_MAX
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomTimeString,
    parse_empty_string_to_none,
)
from app.shared.schemas.responses import BaseAPIResponse

# The minute as the DFB's report writes it: the played minute, and stoppage time after a plus, `45+2`.
MINUTE_PATTERN = r"^[0-9]{1,3}(\+[0-9]{1,2})?$"

CustomSpielberichtMinute = Annotated[str, StringConstraints(pattern=MINUTE_PATTERN)]

# Multi-line, unlike a confirmation's reason: the referee's prose about the match, read on the editor's panel alone.
# Stripped before the floor counts, so spaces alone are no remark.
CustomSpielberichtBemerkungen = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH)
]

FLSpielberichtSeite = Literal["team1", "team2"]

FLKartenFarbe = Literal["gelb", "gelb_rot", "rot"]

# Why a card was shown, from a closed list: a characterisation of a named pupil's conduct, so served on the
# administrator's and the referee's reads alone.
FLKartenGrund = Literal[
    "foulspiel",
    "unsportlichkeit",
    "handspiel",
    "meckern",
    "spielverzoegerung",
    "wiederholtes_foulspiel",
    "grobes_foulspiel",
    "taetlichkeit",
    "beleidigung",
    "notbremse",
]

# The events a referee may propose: the three a match that took place can end in. A fixture called off or struck
# out has no report.
FLSpielberichtSonderereignis = Literal["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]

# Derived on every read from the report and the fixture, and stored nowhere. `abgesagt` is a report on a fixture called
# off or struck out since it was sent: the match took no place, so nothing awaits the administrator.
FLSpielberichtZustand = Literal["vorgeschlagen", "uebernommen", "abweichend", "abgesagt"]


class FLSpielberichtVorschlag(BaseModel):
    """The referee's proposed result, which only the administrator's own save applies.

    Both counts null on a no-show alone: the save composes its goals from the season's forfeit, which typed goals
    could never equal.
    """

    team1_tore: Annotated[int, Field(ge=0)] | None
    team2_tore: Annotated[int, Field(ge=0)] | None
    elfmeterschiessen: FLSpielElfmeterschiessen | None
    sonderereignis: FLSpielberichtSonderereignis | None


class FLSpielberichtTorschuetze(BaseModel):
    """One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one."""

    seite: FLSpielberichtSeite
    spieler_id: CustomObjectId | None
    minute: CustomSpielberichtMinute
    # An own goal keeps the scorer's side and counts for the other one.
    eigentor: bool


class FLSpielberichtKarte(BaseModel):
    """One card as stored, its reason null on a red card and on every card once its season's end strips the reasons."""

    seite: FLSpielberichtSeite
    spieler_id: CustomObjectId
    minute: CustomSpielberichtMinute
    farbe: FLKartenFarbe
    grund: FLKartenGrund | None


class FLSpielberichtKartePayload(FLSpielberichtKarte):
    """One card as a write sends it."""

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def a_caution_names_its_reason(self) -> Self:
        """A yellow and a second yellow are shown for a reason the list holds; a red may stand alone."""

        if self.farbe != "rot" and self.grund is None:
            raise ValueError("Bei Gelb und Gelb-Rot gehört ein Grund dazu.")

        return self


class FLSpielberichtVonSchiedsrichter(BaseModel):
    art: Literal["schiedsrichter"]
    schiedsrichter_id: CustomObjectId


class FLSpielberichtVonAdmin(BaseModel):
    """An administrator who wrote the block first, naming nobody, as an administrator's settle does."""

    art: Literal["admin"]


FLSpielberichtVon = Annotated[FLSpielberichtVonSchiedsrichter | FLSpielberichtVonAdmin, Field(discriminator="art")]


class FLSpielberichtUebernommenVon(BaseModel):
    art: Literal["admin"]


class FLSpielberichtBericht(BaseModel):
    """The referee's account of one match, one proposal: a correction returns all of it to proposed.

    `version` rises with every write and the adoption records the one it took, so adopted means the two are equal,
    whatever a clock says.
    """

    ergebnis_vorschlag: FLSpielberichtVorschlag
    torschuetzen: list[FLSpielberichtTorschuetze]
    karten: list[FLSpielberichtKarte]
    # Its length is the payload's: the read keeps a ban reason's floor alone.
    bemerkungen: CustomNonEmptyString | None
    eingereicht_am: FLUtcInstant
    eingereicht_von: FLSpielberichtVon
    geaendert_am: FLUtcInstant
    version: int
    uebernommen_am: FLUtcInstant | None
    uebernommen_von: FLSpielberichtUebernommenVon | None
    uebernommene_version: int | None


class FLSpielbericht(BaseModel):
    """One fixture's report document, as stored. `bericht` is null on a document a club's line-up created first."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    bericht: FLSpielberichtBericht | None


# --- The WRITES: the referee's PUT and the administrator's PATCH take one body, so a refusal naming
# `bericht.bemerkungen` names a field of both.


class FLSpielberichtBerichtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ergebnis_vorschlag: FLSpielberichtVorschlag
    torschuetzen: Annotated[list[FLSpielberichtTorschuetze], Field(max_length=SPIELBERICHT_EINTRAEGE_MAX)]
    karten: Annotated[list[FLSpielberichtKartePayload], Field(max_length=SPIELBERICHT_EINTRAEGE_MAX)]
    bemerkungen: Annotated[CustomSpielberichtBemerkungen | None, BeforeValidator(parse_empty_string_to_none)]

    @model_validator(mode="after")
    def every_goal_has_one_entry(self) -> Self:
        """Per side, the goals proposed equal the entries credited to it; an own goal credits the other side.

        A no-show proposes the event alone: the league composes its goals, so it carries no count, no shoot-out and
        no scorer.
        """

        vorschlag = self.ergebnis_vorschlag

        if vorschlag.sonderereignis in SONDEREREIGNIS_NO_SHOW:
            if vorschlag.team1_tore is not None or vorschlag.team2_tore is not None or vorschlag.elfmeterschiessen is not None:
                raise ValueError("Bei einem Nichtantreten trägst Du keine Tore ein: Das Ergebnis setzt die Liga.")
            if self.torschuetzen:
                raise ValueError("Bei einem Nichtantreten gibt es keine Torschützen.")
            return self

        if vorschlag.team1_tore is None or vorschlag.team2_tore is None:
            raise ValueError("Zum Ergebnis gehören die Tore beider Teams.")

        if vorschlag.elfmeterschiessen is not None and vorschlag.team1_tore != vorschlag.team2_tore:
            raise ValueError("Ein Elfmeterschießen folgt nur auf ein Unentschieden.")

        gutgeschrieben = {"team1": 0, "team2": 0}
        for tor in self.torschuetzen:
            # An own goal is scored by `seite` and counts for the other side.
            seite = ("team2" if tor.seite == "team1" else "team1") if tor.eigentor else tor.seite
            gutgeschrieben[seite] += 1

        if (gutgeschrieben["team1"], gutgeschrieben["team2"]) != (vorschlag.team1_tore, vorschlag.team2_tore):
            raise ValueError(
                "Für jedes Tor braucht es genau einen Eintrag. "
                f"Die Einträge ergeben {gutgeschrieben['team1']}:{gutgeschrieben['team2']}, "
                f"das Ergebnis lautet {vorschlag.team1_tore}:{vorschlag.team2_tore}."
            )

        return self


class FLSpielberichtPayload(BaseModel):
    """The whole `bericht` block, written wholesale by the referee's PUT and the administrator's PATCH alike."""

    model_config = ConfigDict(extra="forbid")

    bericht: FLSpielberichtBerichtPayload
    # A precondition, written nowhere: the version of the report the form was served, null where none stood. Required
    # with no default, as `kontakte_stand` is: an omitted one would judge nothing
    # (`app/api/spielberichte/services.py :: find_bericht_stand_refusal`).
    bericht_stand: int | None


# --- The READS. The referee's form and the administrator's panel read one shape: the fixture, both live
# squads to pick from, and the stored block.


class FLSpielberichtTeam(BaseModel):
    team_id: CustomObjectId
    name: str


class FLSpielberichtSpiel(BaseModel):
    """The fixture a report is about, as its form states it: no money, no booking, no result."""

    spiel_id: CustomObjectId
    saison_id: str
    saison_phase: FLSaisonPhase
    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None
    team1: FLSpielberichtTeam | None
    team2: FLSpielberichtTeam | None
    sonderereignis: FLSonderereignis | None


class FLSpielberichtSpieler(BaseModel):
    """A pupil a report may name or names, with the names their record holds."""

    spieler_id: CustomObjectId
    vorname: str | None
    nachname: str | None
    nummer: str | None


class FLSpielberichtKader(BaseModel):
    """Each side's live squad of the season, the pupils a new entry may name."""

    team1: list[FLSpielberichtSpieler]
    team2: list[FLSpielberichtSpieler]


# Private, so the two reads below publish their own components and none for the base.
class _SpielberichtAnsicht(BaseAPIResponse):
    spiel: FLSpielberichtSpiel
    kader: FLSpielberichtKader
    # Every pupil the stored block names outside the squads served -- one ausgetragen since the match, or of a club a
    # knockout slot has since replaced -- so an entry stored before keeps its name.
    genannt: list[FLSpielberichtSpieler]
    bericht: FLSpielberichtBericht | None


class FLSpielberichtSchiedsrichterResponse(_SpielberichtAnsicht):
    """The booked referee's form: the remarks and the card reasons included, no derived state."""


class FLSpielberichtAdminResponse(_SpielberichtAnsicht):
    """The administrator's panel, with the state the report reads in. Null exactly where no block stands."""

    zustand: FLSpielberichtZustand | None


class FLSpielberichtPersonEintrag(BaseModel):
    """One played fixture booked to the signed-in referee, and whether their report stands."""

    spiel_id: CustomObjectId
    datum: CustomDateString
    uhrzeit: CustomTimeString | None
    team1_name: str | None
    team2_name: str | None
    eingereicht_am: FLUtcInstant | None


class FLSpielberichtePersonResponse(BaseAPIResponse):
    spiele: list[FLSpielberichtPersonEintrag]


class FLSpielberichtZustandEintrag(BaseModel):
    """One fixture's report as the triage reads it: its state and what it proposes."""

    spiel_id: CustomObjectId
    zustand: FLSpielberichtZustand
    ergebnis_vorschlag: FLSpielberichtVorschlag


class FLSpielberichteSaisonResponse(BaseAPIResponse):
    """Every report of one season that holds a block, each with its state."""

    spielberichte: list[FLSpielberichtZustandEintrag]

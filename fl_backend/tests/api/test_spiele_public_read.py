from collections.abc import Mapping
from typing import Any

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import (
    FLSpiel,
    FLSpielJoined,
    FLSpielJoinedAdmin,
    FLSpielortFieldPublic,
    FLSpielSchiedsrichterFieldPublic,
    FLSpielTeamFieldJoined,
)
from app.api.spieltage.services import build_spielplan
from tests.core.app_source import api_routes, application
from tests.documents import rules_document, spiel_document, spieltag_document

# The two figures `READ-MONEY-001` keeps off the base tier, spelled as a DOCUMENT spells them: the
# assertions below search published property names, where a model's field name need not match.
MIETPREIS_KEY = "mietpreis"
PAYMENT_KEY = "payment"
MONEY_KEYS = frozenset({MIETPREIS_KEY, PAYMENT_KEY})

# What the backend keeps off a served fixture side: the free text naming a school and the day it took
# effect. Spelled as a DOCUMENT spells them, for `MONEY_KEYS`' reason.
AUSTRITT_DETAIL_KEYS = frozenset({"reason", "date"})
AUSTRITT_TYPE_KEY = "austritt_type"

# Searched per SIDE rather than over the whole body: a fixture's own `date` shares its name with a
# withdrawal's, so a body-wide search for that key could never fail.
SIDES = ("team1", "team2")

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIEL_ID = ObjectId("6890a1b2c3d4e5f607240001")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072400a1")
HOME = ObjectId("6890a1b2c3d4e5f607240011")
AWAY = ObjectId("6890a1b2c3d4e5f607240012")
SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607240021")
SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607240022")

MIETPREIS = 80
PAYMENT = 30

SPIELORT_NAME = "Sportplatz Ost"

# Written out rather than composed from the pair, so a reducer agreeing with any spelling of the
# rule -- the whole surname, or the initial without its dot -- fails these cases (`READ-REFEREE-001`).
SCHIEDSRICHTER_SURNAME = "Kern"
SCHIEDSRICHTER_NAME = f"Ada {SCHIEDSRICHTER_SURNAME}"
PUBLIC_SCHIEDSRICHTER_NAME = "Ada K."

AUSTRITT = {"type": "disqualifikation", "reason": "Nicht angetreten zum Spieltag", "date": "2026-03-14"}


def stored_document() -> dict[str, Any]:
    """The fixture as `spiele` holds it: both figures present, and no `austritt`, which a read joins on."""

    return spiel_document(
        spiel_id=SPIEL_ID,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_ID,
        team1={"team_id": HOME, "tore": 2},
        team2={"team_id": AWAY, "tore": 1},
        date="2026-03-15",
        time="14:00:00",
        spielort={"spielort_id": SPIELORT_ID, "mietpreis": MIETPREIS},
        schiedsrichter={"schiedsrichter_id": SCHIEDSRICHTER_ID, "payment": PAYMENT},
        ergebnis="2:1",
    )


def joined_document() -> dict[str, Any]:
    """The same fixture as `build_spiele_pipeline` hands it to a read model: each side merged with BOTH spellings of its withdrawal.

    Derived from `stored_document` rather than spelled a second time, so the money on this raw dict
    is the money a write stored.
    """

    document = stored_document()

    return {
        **document,
        "team1": {**document["team1"], "name": "Alpha", "shorthand": "ALX", "austritt": None, AUSTRITT_TYPE_KEY: None},
        "team2": {**document["team2"], "name": "Beta", "shorthand": "BEX", "austritt": dict(AUSTRITT), AUSTRITT_TYPE_KEY: AUSTRITT["type"]},
        "spielort": {**document["spielort"], "name": SPIELORT_NAME, "maps_link": "Sportplatz Ost, Frankfurt"},
        "ansetzung_confirmed": None,
        "for_third_place": False,
        # A referee publishing their name and agreeing to this fixture: both gates pass, so the reduction is what is left.
        "schiedsrichter": {**document["schiedsrichter"], "name": SCHIEDSRICHTER_NAME, "name_is_public": True, "einsatz_confirmed": True},
    }


def keys_anywhere(payload: Any) -> set[str]:
    """Every mapping key at every depth of a decoded body or a model dump.

    Recursive rather than a lookup at one path: what is asserted is that a figure reaches NO part of
    the answer, and a per-path check proves only the paths somebody thought of.
    """

    if isinstance(payload, Mapping):
        return set(payload) | {key for value in payload.values() for key in keys_anywhere(value)}

    if isinstance(payload, list):
        return {key for item in payload for key in keys_anywhere(item)}

    return set()


def keys_under(payload: Any, field: str) -> set[str]:
    """Every mapping key at every depth BENEATH any `field` key, wherever one is nested.

    Scoped where `keys_anywhere` is not: a fixture's own `date` shares its name with a
    withdrawal's, so a body-wide search for that key could never fail.
    """

    if isinstance(payload, Mapping):
        nested = {key for value in payload.values() for key in keys_under(value, field)}
        return nested | keys_anywhere(payload.get(field))

    if isinstance(payload, list):
        return {key for item in payload for key in keys_under(item, field)}

    return set()


# The whole membership of each base-tier embedded shape, so a field added to one is named here or
# fails. The venue's money-bearing twin extends this shape, so a relation between the two cannot
# stand in.
PUBLIC_EMBEDDED_FIELDS = [
    pytest.param(FLSpielortFieldPublic, frozenset({"spielort_id", "name", "maps_link"}), id="the venue"),
    pytest.param(FLSpielSchiedsrichterFieldPublic, frozenset({"name", "name_is_public"}), id="the referee"),
]

# The base-tier FIXTURE's whole membership. Its aggregation projects no allow-list, so the model is
# the one this read has and a field added to `FLSpielCommon` reaches
# an anonymous caller unnamed.
BASE_TIER_SPIEL_FIELDS = frozenset(
    {
        "id",
        "team1",
        "team2",
        "team1_quelle",
        "team2_quelle",
        "date",
        "time",
        "spielort",
        "schiedsrichter",
        "ergebnis",
        "elfmeterschiessen",
        "spieltag_id",
        "spiel_nr",
        "sonderereignis",
        "saison_phase",
        "saison_id",
        # Published by decision, and past what an erasure rewrites (`READ-FREETEXT-001`).
        "note",
        # A verdict and never a row: no seat, no answer's reason.
        "ansetzung_confirmed",
        # The one rule for the match for third place, which the join composes.
        "for_third_place",
    }
)


class TestTheEmbeddedShapes:
    """What each embedded base-tier model declares, read off `model_fields` rather than off an instance."""

    @pytest.mark.parametrize(("public_model", "public_fields"), PUBLIC_EMBEDDED_FIELDS)
    def test_the_base_tier_shape_declares_exactly_these_fields(self, public_model: type[BaseModel], public_fields: frozenset[str]):
        """An allow-list is one only while its whole membership is pinned.

        A subset relation against the money-bearing twin cannot do it: the venue's twin extends this
        shape, so a field added here propagates there and the relation survives unchanged.
        """

        assert set(public_model.model_fields) == public_fields


class TestTheJoinedSideShapes:
    """Which spelling of a withdrawal the served side declares, read off `model_fields` rather than off an instance."""

    def test_the_served_side_declares_exactly_these_fields(self):
        """The served side's whole membership, since the internal shape inherits it.

        A subset relation would survive a field added here, because it would propagate to the shape
        it is being compared against.
        """

        assert set(FLSpielTeamFieldJoined.model_fields) == {"team_id", "name", "shorthand", "tore", "austritt_type"}


# The block each of a referee's three public states is served as. A withheld name and a booking naming nobody read alike,
# `name` null, which the frontend words as „anonym“; a published name keeps its surname's initial alone.
REFEREE_STATES = [
    pytest.param({"name_is_public": True}, {"name": PUBLIC_SCHIEDSRICHTER_NAME, "name_is_public": True}, id="published"),
    pytest.param({"name_is_public": False}, {"name": None, "name_is_public": False}, id="withheld"),
    pytest.param({"schiedsrichter_id": None, "name": None, "name_is_public": False}, {"name": None, "name_is_public": False}, id="nobody"),
]

# The two base-tier reads listing a season's fixtures, each with the fields its answer holds beside the matchdays.
SCHEDULE_READS = [
    pytest.param("/api/v0/saisons/{saison_id}/spielplan", {"current_spieltag_id": None}, id="Spielplan"),
    pytest.param("/api/v0/saisons/{saison_id}/ko_runde", {}, id="K.-o.-Runde"),
]


class TestTheScheduleServesTheRefereeByConsent:
    """The referee block each schedule read answers with, built by the route's own service into the route's own response model.

    The schedule lists its fixtures through a model of its own, so a fixture case alone would pass a list typed on another.
    """

    @pytest.mark.parametrize(("path", "beside"), SCHEDULE_READS)
    @pytest.mark.parametrize(("referee", "served"), REFEREE_STATES)
    def test_a_public_reader_gets_no_name_whole_and_none_withheld(
        self, path: str, beside: dict[str, Any], referee: dict[str, Any], served: dict[str, Any]
    ):
        document = joined_document()
        fixture = {**document, "schiedsrichter": {**document["schiedsrichter"], **referee}}
        spieltag = spieltag_document(SPIELTAG_ID, SAISON_ID, 1)
        (route,) = [route for route in api_routes(application()) if route.path == path and "GET" in route.methods]

        spieltage = build_spielplan([spieltag], [fixture], FLSaisonRules.model_validate(rules_document()))
        answer = route.response_model.model_validate({"spieltage": spieltage, **beside}).model_dump(mode="json", by_alias=True)

        # The whole block, so the record id and the fee are refused as well as the name.
        assert [spiel["schiedsrichter"] for spiel in answer["spieltage"][0]["spiele"]] == [served]


class TestTheSpielShapes:
    """What each fixture model declares, and what survives validation of ONE raw document through it."""

    def test_the_base_tier_spiel_cuts_the_referees_surname(self):
        """`READ-REFEREE-001`, on the shape a base-tier read answers with rather than on the reducer alone.

        The stored document carries the surname in full, so a model that stopped reducing would serve it.
        """

        parsed = FLSpielJoined.model_validate(joined_document())

        assert parsed.schiedsrichter is not None
        assert parsed.schiedsrichter.name == PUBLIC_SCHIEDSRICHTER_NAME
        assert SCHIEDSRICHTER_SURNAME not in parsed.model_dump_json()

    def test_a_referee_block_the_join_never_judged_is_refused(self):
        """Required as `ansetzung_confirmed` is: served without its verdict, a read that skipped the gate would publish every referee."""

        document = joined_document()
        unjudged = {
            **document,
            "schiedsrichter": {key: value for key, value in document["schiedsrichter"].items() if key != "einsatz_confirmed"},
        }

        with pytest.raises(ValidationError):
            FLSpielJoined.model_validate(unjudged)

    @pytest.mark.parametrize(
        ("schiedsrichter_id", "served"), [pytest.param(None, True, id="nobody"), pytest.param(ObjectId(), False, id="a-referee")]
    )
    def test_a_booking_naming_nobody_is_served_nameless_where_a_referee_s_waits_for_their_agreement(self, schiedsrichter_id, served):
        """An erased referee's played match reads as nobody named; withheld, it would read as no referee booked at all."""

        document = joined_document()
        nobody_agreed = {
            **document,
            "schiedsrichter": {
                **document["schiedsrichter"],
                "schiedsrichter_id": schiedsrichter_id,
                "name": None,
                "name_is_public": False,
                "einsatz_confirmed": False,
            },
        }

        parsed = FLSpielJoined.model_validate(nobody_agreed)

        assert (parsed.schiedsrichter is not None, None if parsed.schiedsrichter is None else parsed.schiedsrichter.name) == (served, None)

    def test_the_base_tier_spiel_declares_exactly_these_fields(self):
        """The tier's whole membership, since neither the admin nor the internal shape narrows it.

        A subset relation against either would survive a field added here, both inheriting this one.
        """

        assert set(FLSpielJoined.model_fields) == BASE_TIER_SPIEL_FIELDS

    def test_the_base_tier_spiel_drops_the_reason_and_the_day(self):
        """`FLSpielJoined` is what the Spielplan and `GET /spiele/{spiel_id}` answer with, and Pydantic ignores an undeclared key."""

        dumped = FLSpielJoined.model_validate(joined_document()).model_dump()

        for side in SIDES:
            assert AUSTRITT_DETAIL_KEYS & keys_under(dumped, side) == set()

    def test_the_admin_spiel_drops_them_too(self):
        """No fixture response carries a reason: the money is withheld by TIER, and the withdrawal is narrowed on every tier at once."""

        dumped = FLSpielJoinedAdmin.model_validate(joined_document()).model_dump()

        for side in SIDES:
            assert AUSTRITT_DETAIL_KEYS & keys_under(dumped, side) == set()


# (stored, what the base tier serves). The surname is everything after the FIRST space, so a
# particle and a double surname reduce whole rather than leaking their front half.
REFEREE_NAME_CASES = [
    pytest.param(SCHIEDSRICHTER_NAME, PUBLIC_SCHIEDSRICHTER_NAME, id="one surname"),
    pytest.param("Ada van der Berg", "Ada v.", id="a particle"),
    pytest.param("Anna Müller Schmidt", "Anna M.", id="a double surname"),
    pytest.param("Prince", "Prince", id="no surname at all"),
]


class TestTheSurnameReduction:
    """`READ-REFEREE-001` over the shapes of name a referee's one free-text field holds.

    A rule taking the LAST word would serve `Ada van der B.` and `Anna Müller S.`, publishing a
    particle or half a double surname.
    """

    @pytest.mark.parametrize(("stored", "served"), REFEREE_NAME_CASES)
    def test_the_base_tier_shape_applies_it(self, stored: str, served: str):
        """Through the model, which is how the rule reaches a caller: a reducer nothing calls would pass a case on the rule alone."""

        published = {"schiedsrichter_id": SCHIEDSRICHTER_ID, "name": stored, "name_is_public": True}

        assert FLSpielSchiedsrichterFieldPublic.model_validate(published).name == served


class TestTheStoredShape:
    """`FLSpiel`, which is on no endpoint and whose dump every write `$set`s wholesale."""

    @pytest.mark.parametrize(
        ("embedded", "money", "amount"),
        [("spielort", MIETPREIS_KEY, MIETPREIS), ("schiedsrichter", PAYMENT_KEY, PAYMENT)],
        ids=["the venue", "the referee"],
    )
    def test_the_dump_a_save_writes_keeps_the_figure(self, embedded: str, money: str, amount: int):
        """Guards the re-declaration on `fl_backend/app/api/spiele/schemas.py :: FLSpiel`, whose docstring holds the reason."""

        dumped = FLSpiel.model_validate(stored_document()).model_dump()[embedded]

        assert dumped[money] == amount


# What no base-tier read may publish anywhere in its answer: the admin fixture shape, either figure, and the booked
# referee's record id. Property names as the document publishes them, which are the keys a body carries.
WITHHELD_PROPERTIES = MONEY_KEYS | {"schiedsrichter_id"}
ADMIN_SPIEL_SCHEMA = FLSpielJoinedAdmin.__name__


def _reached(document: Mapping[str, Any], schema: Any) -> tuple[set[str], set[str]]:
    """Every component schema and every property name a response schema reaches, through every `$ref` and nesting."""

    components = document["components"]["schemas"]
    names: set[str] = set()
    properties: set[str] = set()
    pending = [schema]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            ref = node.get("$ref")
            if ref is None:
                properties.update(node.get("properties", {}))
                pending.extend(node.values())
            elif (name := ref.rsplit("/", 1)[-1]) not in names:
                names.add(name)
                pending.append(components[name])

    return names, properties


def _reads_under(document: Mapping[str, Any], scheme: str) -> dict[str, tuple[set[str], set[str]]]:
    """Every GET the document publishes under `scheme` alone, with what its answer reaches."""

    return {
        path: _reached(document, operation["responses"]["200"]["content"]["application/json"]["schema"])
        for path, operations in document["paths"].items()
        for method, operation in operations.items()
        if method == "get" and operation.get("security") == [{scheme: []}]
    }


def test_no_base_tier_read_publishes_the_admin_spiel_shape_either_figure_or_the_referees_record():
    """Read off the published document, so every base-tier read serving a fixture is held, a new one with no case of its own among them.

    This holds every read's declared shape, where a page's model swapped for the admin fixture shape would serve the
    referee's whole name, the rent and the fee.
    """

    document = application().openapi()
    reads = _reads_under(document, "BaseKey")

    leaks = {path: sorted(({ADMIN_SPIEL_SCHEMA} & names) | (WITHHELD_PROPERTIES & properties)) for path, (names, properties) in reads.items()}
    assert {path: leaked for path, leaked in leaks.items() if leaked} == {}

    # Non-vacuous: the base-tier reads serving a fixture are among those walked, and the walk sees a leak where one
    # stands, the admin fixture reads reaching the shape and all three keys.
    assert [path for path, (_, properties) in reads.items() if "spiel_nr" in properties]
    admin_spiel_reads = [properties for names, properties in _reads_under(document, "AdminKey").values() if ADMIN_SPIEL_SCHEMA in names]
    assert admin_spiel_reads
    assert all(WITHHELD_PROPERTIES <= properties for properties in admin_spiel_reads)

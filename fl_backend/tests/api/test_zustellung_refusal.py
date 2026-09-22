from typing import Any, get_args

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.schemas import FLBewerbungZustellstand
from app.api.bewerbungen.services import ZUSTELLUNG_ABGEWIESEN, compose_zustellung_update, zustellung_event_applies, zustellung_send_applies
from app.api.zustellung.schemas import (
    FLZustellungAbgewiesenPayload,
    FLZustellungAngenommenPayload,
    FLZustellungEreignisPayload,
    FLZustellungZiel,
)
from app.api.zustellung.services import (
    ABGEWIESENER_VERSAND_STAND,
    ZIEL_PFADE,
    compose_ziel_zustellung_update,
    zustellung_pfad,
    zustellung_projektion,
)
from app.core.collections import Collection

ZIEL_OID = "6890a1b2c3d4e5f607970001"

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
SECOND_MESSAGE = "7c1f2b5e-3d44-4a91-9f0b-1e2d3c4b5a60"

# One instant and the two stamps around it, each already in the spelling the payload normalises to.
EARLIER = "2026-03-29T09:00:00.000000+00:00"
STAMP = "2026-03-29T10:00:00.000000+00:00"
LATER = "2026-03-29T11:00:00.000000+00:00"

# The one member `ZIEL_PFADE` carries today, taken from the Literal so a member added later drives
# every case below rather than leaving them pinned to a target that moved.
ZIEL: FLZustellungZiel = get_args(FLZustellungZiel)[0]


def event_body(**overrides: Any) -> dict[str, Any]:
    return {
        "ziel": ZIEL,
        "ziel_id": ZIEL_OID,
        "nachricht_id": FIRST_MESSAGE,
        "stand": "unzustellbar",
        "grund": "NoEmail",
        "am": LATER,
        **overrides,
    }


def abgewiesen_body(**overrides: Any) -> dict[str, Any]:
    """One refusal the provider gave at submit time: no message was minted, so the body names none."""

    return {"ziel": ZIEL, "ziel_id": ZIEL_OID, "grund": "validation_error", "am": LATER, **overrides}


def projiziert(*, traeger: str, record: dict[str, Any] | None, carrier_exists: bool = True) -> dict[str, Any]:
    """One document as `zustellung_projektion` answers it: the carrier present and empty where nothing is known yet."""

    if not carrier_exists:
        return {"_id": ObjectId(ZIEL_OID)}

    return {"_id": ObjectId(ZIEL_OID), traeger: {} if record is None else {"zustellung": record}}


def zustellung(*, nachricht_id: str = FIRST_MESSAGE, stand: str = "angenommen", grund: str | None = None, am: str = STAMP) -> dict[str, Any]:
    return {"nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am}


class TestTheTargetRegister:
    def test_every_member_of_the_closed_set_has_a_home_and_every_home_a_member(self):
        """An equality both ways: a member with no row dispatches to nothing, and a row with no member is unreachable."""

        assert set(ZIEL_PFADE) == set(get_args(FLZustellungZiel))

    def test_every_row_names_a_collection_this_database_declares(self):
        """A name spelled out here could be one `app/core/collections.py` never declared, and the write would open a collection of its own."""

        assert all(isinstance(pfad.collection, Collection) for pfad in ZIEL_PFADE.values())

    def test_no_two_targets_share_a_record(self):
        """Two kinds pointing at one path would apply either kind's event to the other's record."""

        homes = [(pfad.collection, zustellung_pfad(pfad)) for pfad in ZIEL_PFADE.values()]

        assert len(set(homes)) == len(homes)


class TestTheProjectionResolvesTheRecord:
    """A case naming every path the projection resolves (`docs/backend/spec.md` §1.7).

    A widening surfaces in no response model and no guard, and a referee's carrier holds their own
    bookkeeping beside the delivery state.
    """

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_it_names_the_one_delivery_path_and_nothing_else(self, ziel: FLZustellungZiel):
        pfad = ZIEL_PFADE[ziel]

        assert set(zustellung_projektion(pfad)) == {f"{pfad.traeger}.zustellung"}

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_every_path_it_names_is_an_inclusion(self, ziel: FLZustellungZiel):
        """`0` would widen it to everything else, an inclusion projection answering the whole document."""

        assert set(zustellung_projektion(ZIEL_PFADE[ziel]).values()) == {1}


class TestTheSharedJudgesReadTheProjectedDocument:
    """A carrier key parting from what the shared judges read judges nothing and applies every event.

    `tests/api/test_zustellung_execution.py :: TestADeliveryEvent` drives it end to end and is
    db-marked; these place the hazard in the container-free tier.
    """

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_a_record_knowing_nothing_yet_takes_the_send(self, ziel: FLZustellungZiel):
        traeger = ZIEL_PFADE[ziel].traeger

        assert zustellung_send_applies(bestaetigungen=projiziert(traeger=traeger, record=None), seat=traeger, am=STAMP)

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_a_document_carrying_no_delivery_bookkeeping_takes_no_send(self, ziel: FLZustellungZiel):
        """A row never mailed, and one an erasure emptied: the carrier is absent, which is not the same as holding nothing."""

        traeger = ZIEL_PFADE[ziel].traeger

        assert not zustellung_send_applies(
            bestaetigungen=projiziert(traeger=traeger, record=None, carrier_exists=False), seat=traeger, am=STAMP
        )

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_a_send_no_newer_than_the_accept_the_record_holds_is_a_no_op(self, ziel: FLZustellungZiel):
        """One fan-out mints a message per address of a record, so two accepts cross and both stamps are the sending host's."""

        traeger = ZIEL_PFADE[ziel].traeger
        held = projiziert(traeger=traeger, record=zustellung())

        assert zustellung_send_applies(bestaetigungen=held, seat=traeger, am=LATER)
        assert not zustellung_send_applies(bestaetigungen=held, seat=traeger, am=EARLIER)

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_a_send_older_than_the_event_the_record_holds_still_applies(self, ziel: FLZustellungZiel):
        """A provider clock ahead of this host's: dropped here, the record freezes on a superseded message and loses the new one's events."""

        traeger = ZIEL_PFADE[ziel].traeger
        held = projiziert(traeger=traeger, record=zustellung(stand="unzustellbar", grund="NoEmail", am=LATER))

        assert zustellung_send_applies(bestaetigungen=held, seat=traeger, am=EARLIER)

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_only_the_message_the_record_holds_and_a_later_stamp_applies(self, ziel: FLZustellungZiel):
        traeger = ZIEL_PFADE[ziel].traeger
        held = projiziert(traeger=traeger, record=zustellung())

        assert zustellung_event_applies(bestaetigungen=held, seat=traeger, nachricht_id=FIRST_MESSAGE, am=LATER)
        assert not zustellung_event_applies(bestaetigungen=held, seat=traeger, nachricht_id=SECOND_MESSAGE, am=LATER)
        assert not zustellung_event_applies(bestaetigungen=held, seat=traeger, nachricht_id=FIRST_MESSAGE, am=STAMP)
        assert not zustellung_event_applies(bestaetigungen=held, seat=traeger, nachricht_id=FIRST_MESSAGE, am=EARLIER)


class TestWhatTheWriteComposes:
    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_it_writes_one_whole_record_at_the_path_the_register_names(self, ziel: FLZustellungZiel):
        """Field by field a state would keep the `grund` of the refusal before it, which reads as this message's own."""

        pfad = ZIEL_PFADE[ziel]

        update = compose_ziel_zustellung_update(
            pfad=pfad, nachricht_id=SECOND_MESSAGE, stand="unterdrueckt", grund="OnAccountSuppressionList", am=LATER
        )

        assert update == {
            "$set": {
                zustellung_pfad(pfad): zustellung(nachricht_id=SECOND_MESSAGE, stand="unterdrueckt", grund="OnAccountSuppressionList", am=LATER)
            }
        }

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_the_record_is_the_one_the_application_writes(self, ziel: FLZustellungZiel):
        """One stored shape at every home (`app/core/constraints.py :: _ZUSTELLUNG`): a key spelled otherwise validates and reads as nothing."""

        pfad = ZIEL_PFADE[ziel]
        arguments = {"nachricht_id": FIRST_MESSAGE, "stand": "zugestellt", "grund": None, "am": STAMP}

        mine = compose_ziel_zustellung_update(pfad=pfad, **arguments)["$set"][zustellung_pfad(pfad)]
        theirs = compose_zustellung_update(seats=("trainer",), **arguments)["$set"]["bestaetigungen.trainer.zustellung"]

        assert mine == theirs


class TestTheRefusedSend:
    """What the write makes of a send the provider refused before any message existed."""

    def test_the_state_it_writes_is_one_the_clocks_skip(self):
        """The whole of what this write buys: a chase spent on an address the provider will not carry to reaches nobody."""

        assert ABGEWIESENER_VERSAND_STAND in ZUSTELLUNG_ABGEWIESEN

    def test_the_state_it_writes_is_one_the_stored_record_declares(self):
        """A member outside the six aborts the transaction at the validator, where the caller sees a 500 rather than a refusal."""

        assert ABGEWIESENER_VERSAND_STAND in get_args(FLBewerbungZustellstand)

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_the_record_it_writes_joins_no_later_event(self, ziel: FLZustellungZiel):
        """Why the id is empty rather than synthetic: a made-up one would make a real event about a real message look unrelated."""

        pfad = ZIEL_PFADE[ziel]
        written = compose_ziel_zustellung_update(
            pfad=pfad, nachricht_id="", stand=ABGEWIESENER_VERSAND_STAND, grund="validation_error", am=STAMP
        )["$set"][zustellung_pfad(pfad)]

        assert not zustellung_event_applies(
            bestaetigungen=projiziert(traeger=pfad.traeger, record=written), seat=pfad.traeger, nachricht_id=FIRST_MESSAGE, am=LATER
        )

    @pytest.mark.parametrize("ziel", sorted(ZIEL_PFADE), ids=lambda ziel: ziel)
    def test_a_refusal_no_newer_than_the_accept_the_record_holds_is_a_no_op(self, ziel: FLZustellungZiel):
        """Judged as an accept is, both stamps being this host's.

        Retried after the re-send that repaired the address, a refusal would mark a live link.
        """

        traeger = ZIEL_PFADE[ziel].traeger
        held = projiziert(traeger=traeger, record=zustellung())

        assert zustellung_send_applies(bestaetigungen=held, seat=traeger, am=LATER)
        assert not zustellung_send_applies(bestaetigungen=held, seat=traeger, am=EARLIER)


class TestThePayloads:
    def test_the_event_body_parses_and_normalises_its_stamp(self):
        parsed = FLZustellungEreignisPayload.model_validate(event_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.ziel, parsed.stand, parsed.grund, parsed.am) == (ZIEL, "unzustellbar", "NoEmail", LATER)

    def test_a_kind_no_register_holds_is_refused(self):
        """A misfiling this endpoint could not otherwise see: the dispatch would raise on a key it has no row for."""

        with pytest.raises(ValidationError) as failure:
            FLZustellungEreignisPayload.model_validate(event_body(ziel="bewerbung"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["ziel"]

    def test_a_report_naming_no_row_is_refused(self):
        """A kind names a population and not a record, so a body without the id would apply the event to whichever row a caller guessed at."""

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate({key: value for key, value in event_body().items() if key != "ziel_id"})

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate(event_body(ziel_id="nicht-hex"))

    def test_an_undeclared_key_is_refused_on_each(self):
        for payload, body in (
            (FLZustellungEreignisPayload, event_body()),
            (FLZustellungAngenommenPayload, {key: value for key, value in event_body().items() if key not in ("stand", "grund")}),
            (FLZustellungAbgewiesenPayload, abgewiesen_body()),
        ):
            with pytest.raises(ValidationError) as failure:
                payload.model_validate({**body, "erfundenes_feld": "x"})

            assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_accepted_send_declares_no_state_of_its_own(self):
        """`angenommen` is the endpoint's, not the caller's: a body naming a state could record a refusal as an accept."""

        with pytest.raises(ValidationError):
            FLZustellungAngenommenPayload.model_validate(event_body())

    def test_the_refused_send_names_no_message(self):
        """Nothing was minted for a send the provider turned away, so a body carrying an id would name a message no event can be about."""

        with pytest.raises(ValidationError) as failure:
            FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(nachricht_id=FIRST_MESSAGE))

        assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_refused_send_declares_no_state_of_its_own(self):
        """The refused state is the endpoint's: a body naming one could file a complaint against an address that merely failed to parse."""

        with pytest.raises(ValidationError):
            FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(stand="beschwerde"))

    def test_the_refused_send_parses_and_normalises_its_stamp(self):
        parsed = FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.ziel, parsed.grund, parsed.am) == (ZIEL, "validation_error", LATER)

    def test_an_event_may_not_claim_the_accept(self):
        with pytest.raises(ValidationError) as failure:
            FLZustellungEreignisPayload.model_validate(event_body(stand="angenommen"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["stand"]

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("MailboxFull\nBcc: someone@example.com", id="a break forging a header line"),
            pytest.param("x" * 129, id="past the ceiling"),
        ],
    )
    def test_the_provider_token_is_single_line_and_bounded(self, grund: str):
        """It arrives from outside and is rendered beside a German sentence; the prose it is taken from names the recipient.

        Both homes of the token, so one screen cannot be widened alone.
        """

        for payload, body in (
            (FLZustellungEreignisPayload, event_body(grund=grund)),
            (FLZustellungAbgewiesenPayload, abgewiesen_body(grund=grund)),
        ):
            with pytest.raises(ValidationError):
                payload.model_validate(body)

    def test_a_state_carrying_no_token_is_a_null_rather_than_an_omitted_key(self):
        for payload, body in ((FLZustellungEreignisPayload, event_body), (FLZustellungAbgewiesenPayload, abgewiesen_body)):
            assert payload.model_validate(body(grund=None)).grund is None

            with pytest.raises(ValidationError) as failure:
                payload.model_validate({key: value for key, value in body().items() if key != "grund"})

            assert [entry["loc"][-1] for entry in failure.value.errors()] == ["grund"]

    def test_a_value_naming_no_instant_is_refused(self):
        """The ordering is the whole of the idempotency, so a stamp naming no moment orders against nothing."""

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate(event_body(am="2026-03-29"))

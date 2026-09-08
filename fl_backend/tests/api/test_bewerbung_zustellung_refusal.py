from datetime import datetime, timezone
from typing import Any, Mapping, get_args

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungZustellEreignis,
    FLBewerbungZustellstand,
    FLBewerbungZustellungAngenommenPayload,
    FLBewerbungZustellungEreignisPayload,
    normalise_zustellzeitpunkt,
)
from app.api.bewerbungen.services import (
    KONTAKT_SEATS,
    ZUSTELLUNG_ABGEWIESEN,
    compose_bestaetigungen,
    compose_zustellung_update,
    hash_token,
    seat_is_unreachable,
    seat_zustellung,
    zustellung_event_applies,
    zustellung_send_applies,
)
from app.api.bewerbungen.zustellung_router import ZUSTELLUNG_FIELDS

BEWERBUNG_ID = "6890a1b2c3d4e5f607970001"

MAILED_ON = "2026-03-29"

# One instant and the two stamps around it, each already in the spelling the payload normalises to,
# so a case names what it compares rather than what it typed.
EARLIER = "2026-03-29T09:00:00.000000+00:00"
STAMP = "2026-03-29T10:00:00.000000+00:00"
LATER = "2026-03-29T11:00:00.000000+00:00"

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
SECOND_MESSAGE = "7c1f2b5e-3d44-4a91-9f0b-1e2d3c4b5a60"

HASHES: Mapping[str, str] = {seat: hash_token(f"first-{seat}") for seat in KONTAKT_SEATS}


def zustellung(*, nachricht_id: str = FIRST_MESSAGE, stand: str = "angenommen", grund: str | None = None, am: str = STAMP) -> dict[str, Any]:
    return {"nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am}


def bestaetigungen(**entries: Any) -> dict[str, Any]:
    """Three live entries, each carrying the accepted send of the link it was mailed with."""

    block = compose_bestaetigungen(hashes=HASHES, today=MAILED_ON)

    return {**{seat: {**entry, "zustellung": zustellung()} for seat, entry in block.items()}, **entries}


def event_body(**overrides: Any) -> dict[str, Any]:
    return {
        "bewerbung_id": BEWERBUNG_ID,
        "rollen": ["trainer"],
        "nachricht_id": FIRST_MESSAGE,
        "stand": "unzustellbar",
        "grund": "NoEmail",
        "am": LATER,
        **overrides,
    }


class TestTheVocabulary:
    def test_an_event_carries_every_state_but_the_one_the_sender_writes(self):
        """`angenommen` is what the provider ACCEPTING the request means, so an event claiming it would undo the refusal that followed."""

        assert set(get_args(FLBewerbungZustellEreignis)) | {"angenommen"} == set(get_args(FLBewerbungZustellstand))

    def test_the_states_a_clock_reads_are_the_ones_no_later_message_repairs(self):
        """A delayed message still arrives and a delivered one arrived, so neither stops a reminder or holds an application."""

        assert ZUSTELLUNG_ABGEWIESEN < set(get_args(FLBewerbungZustellstand))
        assert ZUSTELLUNG_ABGEWIESEN.isdisjoint({"angenommen", "zugestellt", "verzoegert"})


class TestTheStampIsOneSpelling:
    @pytest.mark.parametrize(
        "spelled",
        [
            pytest.param("2026-03-29T10:00:00Z", id="the Z the provider writes"),
            pytest.param("2026-03-29T10:00:00+00:00", id="an explicit zero offset"),
            pytest.param("2026-03-29 10:00:00.000000+00:00", id="a space between the halves"),
            pytest.param("2026-03-29T12:00:00+02:00", id="another offset naming the same moment"),
        ],
    )
    def test_every_spelling_of_one_moment_normalises_to_one_string(self, spelled: str):
        """The write condition is a string comparison, so two spellings of one instant would order as two."""

        assert normalise_zustellzeitpunkt(spelled) == STAMP

    def test_the_width_is_fixed_so_a_string_comparison_is_an_instant_comparison(self):
        """Sub-second precision at a VARYING width sorts `10:00:01` before `10:00:00.5`, which is the wrong way round."""

        whole = normalise_zustellzeitpunkt("2026-03-29T10:00:00Z")
        fraction = normalise_zustellzeitpunkt("2026-03-29T10:00:00.5Z")
        next_second = normalise_zustellzeitpunkt("2026-03-29T10:00:01Z")

        assert len(whole) == len(fraction) == len(next_second)
        assert whole < fraction < next_second

    @pytest.mark.parametrize(
        "spelled",
        [
            pytest.param("2026-03-29T10:00:00", id="no offset, so no instant"),
            pytest.param("2026-03-29", id="a date alone"),
            pytest.param("gestern Abend", id="not a timestamp at all"),
        ],
    )
    def test_a_value_naming_no_instant_is_refused(self, spelled: str):
        with pytest.raises(ValueError):
            normalise_zustellzeitpunkt(spelled)

    def test_the_stored_spelling_is_the_one_the_log_rows_carry(self):
        """One clock across the database: an operator reading a delivery state beside an action row compares two strings."""

        moment = datetime(2026, 3, 29, 12, 0, tzinfo=timezone.utc)

        assert normalise_zustellzeitpunkt(moment.isoformat()) == moment.isoformat(timespec="microseconds")


class TestWhenAnEventApplies:
    def test_the_message_the_seat_holds_and_a_later_stamp_applies(self):
        assert zustellung_event_applies(bestaetigungen=bestaetigungen(), seat="trainer", nachricht_id=FIRST_MESSAGE, am=LATER)

    def test_an_event_naming_a_superseded_message_is_a_no_op(self):
        """A re-send mints a new message, and the old one's bounce would otherwise mark a link that works."""

        assert not zustellung_event_applies(bestaetigungen=bestaetigungen(), seat="trainer", nachricht_id=SECOND_MESSAGE, am=LATER)

    @pytest.mark.parametrize(
        ("am", "why"),
        [
            pytest.param(STAMP, "the same event again, which the provider may deliver more than once", id="the stamp it already holds"),
            pytest.param(EARLIER, "a delivery overtaking the bounce that followed it", id="an earlier stamp"),
        ],
    )
    def test_an_event_that_is_not_strictly_later_is_a_no_op(self, am: str, why: str):
        assert not zustellung_event_applies(bestaetigungen=bestaetigungen(), seat="trainer", nachricht_id=FIRST_MESSAGE, am=am), why

    def test_a_seat_that_was_never_recorded_as_sent_to_takes_no_event(self):
        """Nothing joins the event to the seat: the id it names is one no message from here ever carried."""

        block = compose_bestaetigungen(hashes=HASHES, today=MAILED_ON)

        assert not zustellung_event_applies(bestaetigungen=block, seat="trainer", nachricht_id=FIRST_MESSAGE, am=LATER)

    @pytest.mark.parametrize("emptied", [None, "not an entry"])
    def test_a_seat_the_application_does_not_hold_takes_no_event(self, emptied: Any):
        block = bestaetigungen(trainer=emptied)

        assert not zustellung_event_applies(bestaetigungen=block, seat="trainer", nachricht_id=FIRST_MESSAGE, am=LATER)


class TestWhenAnAcceptedSendApplies:
    def test_a_seat_that_knows_nothing_yet_takes_the_send(self):
        block = compose_bestaetigungen(hashes=HASHES, today=MAILED_ON)

        assert zustellung_send_applies(bestaetigungen=block, seat="trainer", am=STAMP)

    def test_no_id_is_compared_because_the_send_is_what_mints_one(self):
        """The accepted send establishes the join key, so nothing stored can match it and only the ordering decides."""

        assert zustellung_send_applies(bestaetigungen=bestaetigungen(), seat="trainer", am=LATER)

    @pytest.mark.parametrize("am", [STAMP, EARLIER])
    def test_a_send_older_than_what_the_seat_holds_is_a_no_op(self, am: str):
        """A retried call, or one overtaken by the reminder's send: the newer state stands."""

        assert not zustellung_send_applies(bestaetigungen=bestaetigungen(), seat="trainer", am=am)

    def test_an_erased_seat_takes_no_send(self):
        assert not zustellung_send_applies(bestaetigungen=bestaetigungen(trainer=None), seat="trainer", am=LATER)


class TestWhatTheWriteComposes:
    def test_the_whole_block_per_seat_and_nothing_beside_it(self):
        """Field by field a state would keep the `grund` of the refusal before it, which reads as this message's own."""

        update = compose_zustellung_update(
            seats=("trainer", "ansprechperson"), nachricht_id=SECOND_MESSAGE, stand="unterdrueckt", grund="OnAccountSuppressionList", am=LATER
        )

        assert update == {
            "$set": {
                "bestaetigungen.trainer.zustellung": zustellung(
                    nachricht_id=SECOND_MESSAGE, stand="unterdrueckt", grund="OnAccountSuppressionList", am=LATER
                ),
                "bestaetigungen.ansprechperson.zustellung": zustellung(
                    nachricht_id=SECOND_MESSAGE, stand="unterdrueckt", grund="OnAccountSuppressionList", am=LATER
                ),
            }
        }


class TestASeatTheProviderRefuses:
    @pytest.mark.parametrize("stand", sorted(get_args(FLBewerbungZustellstand)))
    def test_only_a_refusal_makes_a_seat_unreachable(self, stand: str):
        block = bestaetigungen(trainer={**bestaetigungen()["trainer"], "zustellung": zustellung(stand=stand)})

        assert seat_is_unreachable(bestaetigungen=block, seat="trainer") == (stand in ZUSTELLUNG_ABGEWIESEN)

    @pytest.mark.parametrize(
        "block",
        [
            pytest.param(compose_bestaetigungen(hashes=HASHES, today=MAILED_ON), id="nothing known about the message yet"),
            pytest.param({"trainer": None}, id="an erased seat"),
            pytest.param(None, id="an application stored before the flow"),
        ],
    )
    def test_a_seat_with_no_delivery_state_is_not_unreachable(self, block: Any):
        """Silence is not a refusal: an application stored before the field, and one whose seat was emptied, are chased and swept as before."""

        assert seat_zustellung(bestaetigungen=block, seat="trainer") is None
        assert not seat_is_unreachable(bestaetigungen=block, seat="trainer")


class TestTheTwoPayloads:
    def test_the_event_body_parses_and_normalises_its_stamp(self):
        parsed = FLBewerbungZustellungEreignisPayload.model_validate(event_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.stand, parsed.grund, parsed.am) == ("unzustellbar", "NoEmail", LATER)

    def test_an_undeclared_key_is_refused_on_both(self):
        for payload, body in (
            (FLBewerbungZustellungEreignisPayload, event_body()),
            (FLBewerbungZustellungAngenommenPayload, {key: value for key, value in event_body().items() if key not in ("stand", "grund")}),
        ):
            with pytest.raises(ValidationError) as failure:
                payload.model_validate({**body, "erfundenes_feld": "x"})

            assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_accepted_send_declares_no_state_of_its_own(self):
        """`angenommen` is the endpoint's, not the caller's: a body naming a state could record a refusal as an accept."""

        with pytest.raises(ValidationError):
            FLBewerbungZustellungAngenommenPayload.model_validate(event_body())

    def test_an_event_may_not_claim_the_accept(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(stand="angenommen"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["stand"]

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("MailboxFull\nBcc: someone@example.com", id="a break forging a header line"),
            pytest.param("x" * 129, id="past the ceiling"),
        ],
    )
    def test_the_provider_token_is_single_line_and_bounded(self, grund: str):
        """It is rendered beside a German sentence, and it arrives from outside; the prose it is taken from names the recipient."""

        with pytest.raises(ValidationError):
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(grund=grund))

    def test_a_state_carrying_no_token_is_a_null_rather_than_an_omitted_key(self):
        assert FLBewerbungZustellungEreignisPayload.model_validate(event_body(grund=None)).grund is None

        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate({key: value for key, value in event_body().items() if key != "grund"})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["grund"]

    def test_a_seat_no_application_has_is_refused_rather_than_stored(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(rollen=["hausmeister"]))

        assert [entry["loc"][0] for entry in failure.value.errors()] == ["rollen"]

    def test_an_event_naming_no_seat_parses_and_reaches_none(self):
        """The frontend route drops an untagged event before this endpoint; an empty list here writes nothing all the same."""

        assert FLBewerbungZustellungEreignisPayload.model_validate(event_body(rollen=[])).rollen == []


class TestTheProjectionResolvesEverySeat:
    """§1.7's rule for a projection: a case naming every path it resolves.

    A widening surfaces in no response model and no guard, so nothing else stands between the
    block's three people and a read that carries them.
    """

    def test_it_names_one_delivery_path_per_seat_and_nothing_else(self):
        assert set(ZUSTELLUNG_FIELDS) == {f"bestaetigungen.{seat}.zustellung" for seat in KONTAKT_SEATS}

    def test_every_path_it_names_is_an_inclusion(self):
        """`0` would widen it to everything else, an inclusion projection answering the whole document."""

        assert set(ZUSTELLUNG_FIELDS.values()) == {1}

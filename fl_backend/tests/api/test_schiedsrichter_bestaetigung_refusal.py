from collections.abc import Mapping
from typing import Any, get_args

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.bewerbungen.services import hash_token, mint_token
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterBestaetigung,
    FLSchiedsrichterBestaetigungAnsichtPayload,
    FLSchiedsrichterBestaetigungAnsichtResponse,
    FLSchiedsrichterBestaetigungPayload,
    FLSchiedsrichterBestaetigungResponse,
    FLSchiedsrichterMint,
    FLSchiedsrichterUmfang,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    BESTAETIGUNG_FELD,
    EINLADEN_FIELDS,
    EINWILLIGUNG_FELD,
    SCHIEDSRICHTER_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_ALREADY_CONFIRMED,
    SCHIEDSRICHTER_ALTER,
    SCHIEDSRICHTER_ERTEILT_VON,
    SCHIEDSRICHTER_KEINE_ADRESSE,
    SCHIEDSRICHTER_RETIRED,
    SCHIEDSRICHTER_TOKEN_EXPIRED,
    SCHIEDSRICHTER_TOKEN_UNKNOWN,
    bestaetigung_frist_from,
    build_token_filter,
    compose_bestaetigung,
    compose_confirmation_update,
    compose_einwilligung,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_gesperrt_refusal,
    find_korrektur_mint,
    find_missing_address_refusal,
    find_retired_refusal,
    find_unknown_token_refusal,
    frist_of,
    vorname_of,
    zustand_of,
)
from app.api.spieler.schemas import FLEinwilligung
from app.api.zustellung.services import ZIEL_PFADE
from app.core.collections import Collection
from app.core.constraints import _SCHIEDSRICHTER_BESTAETIGUNG, COLLECTION_VALIDATORS, SUPPORT_INDEXES, UNIQUE_INDEXES
from app.shared.schemas.bounds import BEWERBUNG_KONTAKT_MAX_AGE_YEARS, BEWERBUNG_TOKEN_MAX_LENGTH, SCHIEDSRICHTER_MIN_AGE_YEARS

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

RAW_TOKEN = "raw-token-for-one-referee"
TOKEN_HASH = hash_token(RAW_TOKEN)

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

LIVE_BLOCK: Mapping[str, Any] = compose_bestaetigung(token_hash=TOKEN_HASH, today=TODAY)


def confirmed(*, bestaetigt_am: str = TODAY) -> dict[str, Any]:
    return {**compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY), "bestaetigt_am": bestaetigt_am}


class TestTheStoredBlock:
    def test_the_model_declares_every_key_the_validator_requires_but_the_hash(self):
        required = set(_SCHIEDSRICHTER_BESTAETIGUNG["required"])

        assert required - set(FLSchiedsrichterBestaetigung.model_fields) == {"token_hash"}

    def test_the_mint_composes_every_key_the_validator_requires(self):
        assert set(_SCHIEDSRICHTER_BESTAETIGUNG["required"]) <= set(LIVE_BLOCK)

    def test_the_carrier_key_is_the_one_the_delivery_register_files_a_report_under(self):
        """Parted, a bounce would be written at a path no link is stored at and every report would apply to nothing."""

        assert ZIEL_PFADE["schiedsrichter"].traeger == BESTAETIGUNG_FELD
        assert ZIEL_PFADE["schiedsrichter"].collection == Collection.SCHIEDSRICHTER

    def test_the_deadline_is_the_bound_counted_from_the_mint(self):
        assert bestaetigung_frist_from(today=TODAY) == "2026-04-15"
        assert LIVE_BLOCK["frist"] == bestaetigung_frist_from(today=TODAY)

    def test_a_fresh_mint_chases_nobody_and_carries_no_delivery_state(self):
        assert LIVE_BLOCK["erinnert_am"] is None
        assert "zustellung" not in LIVE_BLOCK

    def test_the_lookup_is_the_hash_alone(self):
        """No `inactive_since` term: a person retired after the mint still owns the answer they give."""

        assert build_token_filter(token_hash=TOKEN_HASH) == {f"{BESTAETIGUNG_FELD}.token_hash": TOKEN_HASH}


class TestTheRecordTheConfirmationWrites:
    def test_it_is_one_set_carrying_the_birthdate_and_the_record(self):
        """One write and never two: between them the row would hold a birthdate nobody had yet consented to the league keeping."""

        update = compose_confirmation_update(
            geburtsdatum=AN_ADULTS_BIRTHDATE, umfang="kader_oeffentlich", medien=True, text_version="v1", today=TODAY
        )

        assert set(update) == {"$set"}
        assert set(update["$set"]) == {"geburtsdatum", EINWILLIGUNG_FELD}

    def test_the_record_carries_the_media_answer_even_when_it_is_off(self):
        """An off switch is an answer, so the key is stored rather than omitted for the model's default to supply."""

        assert compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)["medien"] is False

    def test_nobody_may_answer_for_a_referee(self):
        record = compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)

        assert record["erteilt_von"] == SCHIEDSRICHTER_ERTEILT_VON
        assert record["datum"] == record["bestaetigt_am"] == TODAY

    def test_the_record_carries_every_key_the_validator_requires(self):
        declared = COLLECTION_VALIDATORS[Collection.SCHIEDSRICHTER]["$jsonSchema"]["properties"][EINWILLIGUNG_FELD]

        assert set(declared["required"]) <= set(compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY))


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-002`: a first name and a role, and no field the admin tier holds."""

    @pytest.mark.parametrize("projection", [BESTAETIGUNG_ANSICHT_FIELDS, BESTAETIGUNG_ANTWORT_FIELDS], ids=["ansicht", "antwort"])
    def test_neither_projection_reaches_a_field_behind_the_contact_rule(self, projection: Mapping[str, int]):
        withheld = {"schule", "kontakt", "default_payment", "geburtsdatum", "inactive_since"}

        assert not {key.partition(".")[0] for key, kept in projection.items() if kept} & withheld

    def test_the_view_declares_exactly_the_five_names_it_may_answer(self):
        """An EQUALITY, not a subset: a field added to this model reaches a caller holding nothing but a token."""

        assert set(FLSchiedsrichterBestaetigungAnsichtResponse.model_fields) == {
            "acknowledged",
            "zustand",
            "vorname",
            "text_version",
            "mindestalter",
            "frist",
        }

    def test_the_mint_answers_the_address_the_link_was_minted_for(self):
        """REQUIRED and not optional: a caller left to its own earlier read mails the credential to a mailbox a rival save has replaced."""

        assert set(FLSchiedsrichterMint.model_fields) == {"token", "frist", "email"}
        assert FLSchiedsrichterMint.model_fields["email"].is_required()

    @pytest.mark.parametrize(
        "model", [FLSchiedsrichterBestaetigungAnsichtResponse, FLSchiedsrichterBestaetigungResponse], ids=["ansicht", "antwort"]
    )
    def test_neither_base_tier_answer_carries_the_mint(self, model: type[BaseModel]):
        """The address a link was minted for is an administrator's fact, so neither anonymous reader embeds that model."""

        assert not {name for name, field in model.model_fields.items() if field.annotation is FLSchiedsrichterMint}
        assert "email" not in model.model_fields

    @pytest.mark.parametrize("projection", [BESTAETIGUNG_ANSICHT_FIELDS, BESTAETIGUNG_ANTWORT_FIELDS], ids=["ansicht", "antwort"])
    def test_neither_projection_reaches_the_hash_the_filter_matched(self, projection: Mapping[str, int]):
        assert f"{BESTAETIGUNG_FELD}.token_hash" not in projection

    def test_the_view_needs_no_key_to_patch_on(self):
        assert BESTAETIGUNG_ANSICHT_FIELDS["_id"] == 0
        assert BESTAETIGUNG_ANTWORT_FIELDS.get("_id", 1) == 1

    @pytest.mark.parametrize(
        ("name", "vorname"),
        [("Pierluigi Collina", "Pierluigi"), ("  Quillhilde  ", "Quillhilde"), ("Anna Lena Bramblewick", "Anna"), (None, None), ("", None)],
    )
    def test_only_the_first_part_of_the_stored_name_is_served(self, name: Any, vorname: str | None):
        assert vorname_of(name) == vorname


class TestWhatAReopenedLinkShows:
    @pytest.mark.parametrize(
        ("einwilligung", "bestaetigung", "zustand"),
        [
            (None, LIVE_BLOCK, "gueltig"),
            (None, {**LIVE_BLOCK, "frist": YESTERDAY}, "abgelaufen"),
            (confirmed(), LIVE_BLOCK, "bestaetigt"),
            # A stamp outranks the deadline: a person who answered on the last valid day is shown that they did.
            (confirmed(), {**LIVE_BLOCK, "frist": YESTERDAY}, "bestaetigt"),
        ],
        ids=["live", "over", "answered", "answered-then-over"],
    )
    def test_each_state_reads_as_the_page_expects(self, einwilligung: Any, bestaetigung: Any, zustand: str):
        assert zustand_of(einwilligung=einwilligung, bestaetigung=bestaetigung, today=TODAY) == zustand


class TestABlockWithNoReadableDeadline:
    """A row the hash filter matched carries the block that hash sits in, so this state is one the validator admits from nobody."""

    @pytest.mark.parametrize(
        "bestaetigung", [None, {}, {"frist": None}, {"frist": 14}, "not-a-block"], ids=["absent", "empty", "null", "number", "unreadable"]
    )
    def test_the_view_answers_the_dead_link_rather_than_serialising_it(self, bestaetigung: Any):
        """Defensive, and never `str()` over `Any`: that spelling answers the string "None" and the response model then 500s."""

        refusal = find_unknown_token_refusal(found=isinstance(frist_of(bestaetigung), str))

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_block_carrying_a_readable_deadline_is_served(self):
        assert find_unknown_token_refusal(found=isinstance(frist_of(LIVE_BLOCK), str)) is None


class TestTheTokenPayloadBound:
    def test_a_minted_token_fits_the_bound_both_endpoints_take(self):
        raw, _ = mint_token()

        assert len(raw) <= BEWERBUNG_TOKEN_MAX_LENGTH
        assert FLSchiedsrichterBestaetigungAnsichtPayload(token=raw).token == raw

    def test_a_token_past_the_bound_is_refused_before_a_read(self):
        with pytest.raises(ValidationError):
            FLSchiedsrichterBestaetigungAnsichtPayload(token="x" * (BEWERBUNG_TOKEN_MAX_LENGTH + 1))

    def test_the_media_answer_is_required_rather_than_defaulted(self):
        """A page omitting it would store the model's answer in place of the person's."""

        with pytest.raises(ValidationError):
            FLSchiedsrichterBestaetigungPayload.model_validate(
                {"token": RAW_TOKEN, "geburtsdatum": AN_ADULTS_BIRTHDATE, "umfang": "intern", "text_version": "v1"}
            )


class TestATokenNoRefereeHolds:
    def test_a_hash_a_referee_holds_is_not_refused(self):
        assert find_unknown_token_refusal(found=True) is None

    def test_a_hash_no_referee_holds_is_refused(self):
        refusal = find_unknown_token_refusal(found=False)

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_the_three_origins_answer_one_code_and_one_message(self):
        """A stranger's guess, a hash a later mint replaced and a deleted document all leave the lookup empty.

        Answered apart, the message would tell whoever guessed which of the three they had found.
        """

        # The lookup's own answer for each, which is what parts these three anywhere at all.
        guessed, replaced, erased = (find_unknown_token_refusal(found=False) for _ in range(3))

        assert guessed == replaced == erased
        assert guessed is not None
        assert guessed.error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN


class TestALinkWhoseDeadlineHasPassed:
    @pytest.mark.parametrize(
        ("frist", "refused"),
        [(TOMORROW, False), (TODAY, False), (YESTERDAY, True), (None, True), (12, True)],
        ids=["before", "on-the-day", "after", "no-deadline", "unreadable"],
    )
    def test_each_boundary_falls_where_the_rule_says(self, frist: Any, refused: bool):
        """The deadline's own day still works, and a block carrying no readable one is over: nothing can say it is still running."""

        refusal = find_expired_token_refusal(frist=frist, today=TODAY)

        assert (refusal is not None) is refused
        if refusal is not None:
            assert refusal.error_code == SCHIEDSRICHTER_TOKEN_EXPIRED


class TestAnEntryAlreadyConfirmed:
    @pytest.mark.parametrize(
        "einwilligung",
        [None, {"umfang": "intern", "bestaetigt_am": None}, "not-a-record"],
        ids=["absent", "unstamped", "unreadable"],
    )
    def test_an_entry_nobody_has_answered_takes_one(self, einwilligung: Any):
        assert find_already_confirmed_refusal(einwilligung=einwilligung) is None

    def test_a_stamped_record_takes_no_second_answer(self):
        """The STAMP spends the link and never a nulled hash, so a second press is told why rather than answering `-002`."""

        refusal = find_already_confirmed_refusal(einwilligung=confirmed())

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_ALREADY_CONFIRMED

    def test_the_stamp_outranks_the_deadline_where_both_would_refuse(self):
        """A person who answered on the last valid day and presses again is told their answer stands.

        The other order sends them off for a fresh link, which repairs a state they are not in.
        """

        over = {**LIVE_BLOCK, "frist": YESTERDAY}

        assert find_already_confirmed_refusal(einwilligung=confirmed()) is not None
        assert find_expired_token_refusal(frist=frist_of(over), today=TODAY) is not None
        assert zustand_of(einwilligung=confirmed(), bestaetigung=over, today=TODAY) == "bestaetigt"

    def test_the_re_send_reads_the_stamp_it_judges(self):
        """A confirmed referee takes no fresh link: minting one would replace a live block with a credential the confirmation always refuses."""

        assert f"{EINWILLIGUNG_FELD}.bestaetigt_am" in EINLADEN_FIELDS


class TestTheAgeThisConsentAsks:
    """The referee's own floor and ceiling.

    The arithmetic under them is `fl_backend/tests/shared/test_alter.py :: TestWholeYears`, which
    pins it for all three consent flows at once.
    """

    @pytest.mark.parametrize(
        ("geburtsdatum", "refused"),
        [("2010-04-01", False), ("2010-04-02", True), (AN_ADULTS_BIRTHDATE, False), (A_CHILDS_BIRTHDATE, True), ("1880-01-01", True)],
        ids=["exactly-the-floor", "a-day-short", "an-adult", "a-child", "a-mistyped-century"],
    )
    def test_each_boundary_falls_where_the_bound_says(self, geburtsdatum: str, refused: bool):
        refusal = find_alter_refusal(geburtsdatum=geburtsdatum, today=TODAY)

        assert (refusal is not None) is refused
        if refusal is not None:
            assert refusal.error_code == SCHIEDSRICHTER_ALTER

    @pytest.mark.parametrize(
        ("geburtsdatum", "bound"),
        [(A_CHILDS_BIRTHDATE, SCHIEDSRICHTER_MIN_AGE_YEARS), ("1880-01-01", BEWERBUNG_KONTAKT_MAX_AGE_YEARS)],
        ids=["floor", "ceiling"],
    )
    def test_each_refusal_names_the_bound_it_judged_by(self, geburtsdatum: str, bound: int):
        refusal = find_alter_refusal(geburtsdatum=geburtsdatum, today=TODAY)

        assert refusal is not None
        assert str(bound) in refusal.message


class TestARetiredRefereeTakesNoFreshLink:
    def test_a_live_referee_is_not_refused(self):
        assert find_retired_refusal(inactive_since=None) is None

    def test_a_retired_one_is(self):
        """A refusal to COLLECT: a row taking no new booking would be asked to consent to a role nobody can give them."""

        refusal = find_retired_refusal(inactive_since="2026-01-01")

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_RETIRED

    def test_the_re_send_reads_the_state_it_judges(self):
        assert "inactive_since" in EINLADEN_FIELDS

    def test_the_save_that_re_mints_reads_it_too(self):
        """A corrected address mails a fresh link, so the save meets this refusal on the mint's own reason.

        Left out, the one mint that never asked whether they still officiate mails them a consent
        link, and nothing fails.
        """

        stored = {"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: None, "inactive_since": "2026-01-01"}
        minted = find_korrektur_mint(stored=stored, payload_email="new@example.com", token_hash=TOKEN_HASH, today=TODAY)

        assert minted is not None
        refusal = find_retired_refusal(inactive_since=stored["inactive_since"])

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_RETIRED


class TestARefereeWithNoAddress:
    def test_an_address_is_not_refused(self):
        assert find_missing_address_refusal(email="collina@example.com") is None

    def test_a_missing_one_is(self):
        """Refused at the write and not at the calling surface alone: a stamped `verschickt_am` would record a message never composed."""

        refusal = find_missing_address_refusal(email=None)

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_KEINE_ADRESSE

    def test_the_re_send_reads_the_address_it_judges(self):
        assert "kontakt.email" in EINLADEN_FIELDS


class TestAnAddressOnTheBanList:
    def test_an_address_the_list_does_not_hold_is_not_refused(self):
        assert find_gesperrt_refusal(gesperrt=False) is None

    def test_one_it_holds_is(self):
        refusal = find_gesperrt_refusal(gesperrt=True)

        assert refusal is not None
        assert refusal.error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT


class TestACorrectedAddressReMints:
    """The ruled behaviour: an unconfirmed referee's old link was posted to a mailbox nobody reads."""

    @pytest.mark.parametrize(
        ("stored", "payload_email"),
        [
            ({"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: None}, "new@example.com"),
            ({"kontakt": {"email": None}, EINWILLIGUNG_FELD: None}, "first@example.com"),
        ],
        ids=["address-moved", "address-entered"],
    )
    def test_an_unconfirmed_referee_whose_address_moves_gets_a_fresh_block(self, stored: Mapping[str, Any], payload_email: str):
        minted = find_korrektur_mint(stored=stored, payload_email=payload_email, token_hash=TOKEN_HASH, today=TODAY)

        assert minted == {BESTAETIGUNG_FELD: compose_bestaetigung(token_hash=TOKEN_HASH, today=TODAY)}

    @pytest.mark.parametrize(
        ("stored", "payload_email"),
        [
            ({"kontakt": {"email": "same@example.com"}, EINWILLIGUNG_FELD: None}, "same@example.com"),
            ({"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: confirmed()}, "new@example.com"),
            ({"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: None}, None),
        ],
        ids=["address-unchanged", "already-confirmed", "address-cleared"],
    )
    def test_every_other_save_mints_nothing(self, stored: Mapping[str, Any], payload_email: Any):
        assert find_korrektur_mint(stored=stored, payload_email=payload_email, token_hash=TOKEN_HASH, today=TODAY) is None

    def test_a_confirmed_referees_corrected_address_is_stopped_here_and_by_no_refusal(self):
        """The already-answered half of the save's mint is this early return, which the two refusals beside it never reach.

        Named because the invariant over all three mints reads as though a refusal carried every half.
        """

        stored = {"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: confirmed(), "inactive_since": None}

        assert find_korrektur_mint(stored=stored, payload_email="new@example.com", token_hash=TOKEN_HASH, today=TODAY) is None
        assert find_already_confirmed_refusal(einwilligung=stored[EINWILLIGUNG_FELD]) is not None
        assert find_retired_refusal(inactive_since=stored["inactive_since"]) is None

    def test_the_fresh_block_restarts_the_deadline(self):
        minted = find_korrektur_mint(
            stored={"kontakt": {"email": "old@example.com"}, EINWILLIGUNG_FELD: None},
            payload_email="new@example.com",
            token_hash=TOKEN_HASH,
            today=TOMORROW,
        )

        assert minted is not None
        assert minted[BESTAETIGUNG_FELD]["frist"] == bestaetigung_frist_from(today=TOMORROW)


class TestTheDeadlineIsStoredRatherThanDerived:
    def test_the_block_holds_it_so_a_raised_bound_moves_no_link_already_sent(self):
        assert LIVE_BLOCK["frist"] != LIVE_BLOCK["verschickt_am"]
        assert "frist" in _SCHIEDSRICHTER_BESTAETIGUNG["required"]


class TestTheHashLookupIsIndexed:
    """Driven by strangers, and by nothing else: a token nobody minted is what the collection is scanned for."""

    def test_the_register_carries_the_key_the_token_filter_matches_on(self):
        declared = next(index for index in SUPPORT_INDEXES if index.name == "schiedsrichter_bestaetigung_token_hash")

        assert declared.collection == Collection.SCHIEDSRICHTER
        assert dict(declared.keys) == {next(iter(build_token_filter(token_hash=TOKEN_HASH))): ASCENDING}

    def test_it_is_a_support_index_rather_than_a_unique_one(self):
        """Two referees carrying one hash is a collision nothing produces, so uniqueness would buy a refusal rather than a rule."""

        keyed = {key for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER for key in index.keys}

        assert f"{BESTAETIGUNG_FELD}.token_hash" not in keyed


class TestTheScopeIsOneSetOfValues:
    def test_the_payloads_literal_and_the_stored_records_agree_exactly(self):
        """A second spelling widened alone takes a scope mongod refuses, and the consent press 500s under a green suite."""

        assert get_args(FLSchiedsrichterUmfang) == get_args(FLEinwilligung.model_fields["umfang"].annotation)

    def test_both_wire_shapes_take_that_one_spelling(self):
        assert FLSchiedsrichterBestaetigungPayload.model_fields["umfang"].annotation is FLSchiedsrichterUmfang
        assert FLSchiedsrichterBestaetigungResponse.model_fields["umfang"].annotation is FLSchiedsrichterUmfang

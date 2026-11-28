from collections.abc import Mapping
from typing import Any, Final, Literal, TypeAliasType, get_args, get_origin

from pydantic import BaseModel

from app.core.exceptions import rule_refusal
from app.shared.einwilligung_evidence import CHOICES, FLEinwilligungChoice, TextVersions
from app.shared.schemas.literals import FLEinwilligungScope, FLKontaktKenntnisnahmeScope
from app.shared.schemas.responses import BasePayload, BaseReadModel

# The label of each consent's current wording, the one every press names, a withdrawal's included: a page loaded before
# a deploy moved a label is refused once, and its person reloads to read the new words. The press fields below are also
# the labels a stored record may cite, so a rewording that moved a label here alone would refuse every read of a record
# citing the old one: the old label stays in `FLEinwilligungTextVersion`, and `cite_their_kind` reads a set holding both.
type FLWhatsappTextVersion = Literal["2026-11-whatsapp-1"]
type FLMediaTextVersion = Literal["2026-11-media-1"]
type FLNameKaderTextVersion = Literal["2026-11-name-kader-1"]
type FLNameSpielplanTextVersion = Literal["2026-11-name-spielplan-1"]

# Every label any record cites: the frontend's `CONSENT_WORDINGS` keys their words by it, checked against it through the
# published contract.
type FLEinwilligungTextVersion = FLWhatsappTextVersion | FLNameKaderTextVersion | FLNameSpielplanTextVersion | FLMediaTextVersion


def labels_of(alias: Any) -> frozenset[str]:
    """Every label a label alias admits, through the aliases and unions it is built of."""

    if isinstance(alias, TypeAliasType):
        return labels_of(alias.__value__)
    if get_origin(alias) is Literal:
        return frozenset(get_args(alias))

    return frozenset().union(*(labels_of(member) for member in get_args(alias)))


class FLEinwilligungReceipt(BaseModel):
    """When a person set one consent choice, and under which wording."""

    # An instant in UTC, where the block carries a day: two acts on one day are ordered by it.
    at: str
    # The words the person was shown for this choice. Any record's label on a read, and its own kind's and choice's on
    # the record model the read-back judges (`cite_their_kind`).
    text_version: FLEinwilligungTextVersion


class FLEinwilligungEvidence(FLEinwilligungReceipt, BaseReadModel):
    """The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended."""

    given_before: FLEinwilligungReceipt | None = None


class FLEinwilligungMailWithdrawal(BaseReadModel):
    """The evidence of a withdrawal an administrator entered from the person's mail, and the grant it ended.

    No label: the person withdrew in their own words, reading none of the league's.
    """

    at: str
    via: Literal["mail"]
    given_before: FLEinwilligungReceipt | None


class FLEinwilligungEvidenceSet(BaseReadModel):
    """Each choice's evidence, null until its person sets it: a record no person has answered carries none."""

    # Told apart by their required keys, `text_version` and `via`, which neither shape holds of the other.
    scope: FLEinwilligungEvidence | FLEinwilligungMailWithdrawal | None = None
    media: FLEinwilligungEvidence | FLEinwilligungMailWithdrawal | None = None


class FLEinwilligungState(BaseModel):
    """Each choice's state where the account page was served, null where the record carried no evidence for it.

    A consent PATCH's precondition, echoed back as served, never a secret.
    """

    # Required with no default: an omitted precondition judges nothing.
    scope: str | None
    media: str | None


# As a press echoes it. Forbidden rather than ignored: a key the precondition does not compare would
# read as judged.
class FLEinwilligungStatePayload(FLEinwilligungState, BasePayload):
    pass


# The labels a press was given under, one per choice, each recorded on that choice's evidence. Both on every press, so
# neither choice is judged by nothing; one model per kind of record, whose scope wordings differ. Each field admits its
# choice's current label alone, so a press from a page loaded before a rewording is refused, a withdrawal's as well; the
# same fields name every label the kind's stored evidence may cite (`cite_their_kind`).
class _TextVersions(BasePayload):
    pass


class FLSeatTextVersions(_TextVersions):
    """A contact seat's two wordings: the WhatsApp switch and the media switch."""

    scope: FLWhatsappTextVersion
    media: FLMediaTextVersion


class FLSpielerTextVersions(_TextVersions):
    """A pupil's two wordings: the name on the squad and the media switch."""

    scope: FLNameKaderTextVersion
    media: FLMediaTextVersion


class FLSchiedsrichterTextVersions(_TextVersions):
    """A referee's two wordings: the name on the fixtures and the media switch."""

    scope: FLNameSpielplanTextVersion
    media: FLMediaTextVersion


type PressTextVersions = FLSeatTextVersions | FLSpielerTextVersions | FLSchiedsrichterTextVersions


def by_choice(text_versions: PressTextVersions) -> TextVersions:
    """A press's labels keyed by the choice each evidences, as the evidence writers take them."""

    return {"scope": text_versions.scope, "media": text_versions.media}


def cite_their_kind(evidence_set: FLEinwilligungEvidenceSet, kind: type[_TextVersions]) -> FLEinwilligungEvidenceSet:
    """Refuse evidence citing a label its kind's record never shows for that choice, as the read-back judges a record.

    The labels are read off `kind`'s field for the choice. A withdrawal by mail cites none, and the grant it ended is
    judged as a press's is.
    """

    for choice in CHOICES:
        evidence = getattr(evidence_set, choice)
        receipts = [] if evidence is None else [evidence, evidence.given_before]
        cited = labels_of(kind.model_fields[choice].annotation)
        if any(isinstance(receipt, FLEinwilligungReceipt) and receipt.text_version not in cited for receipt in receipts):
            raise rule_refusal("text_version_of_another_wording", "the evidence cites a wording its choice never shows", {"choice": choice})

    return evidence_set


class _OwnEinwilligungPayload(BasePayload):
    # Both choices on every press, and no member defaulted: a default would let a page that forgot one
    # reset the person's other choice.
    scope: FLEinwilligungScope
    media: bool
    # The record's `evidence_state` as the page was served it.
    evidence_state: FLEinwilligungStatePayload


class FLAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A pupil's or a registration's own two choices on their record."""

    text_versions: FLSpielerTextVersions


class FLSchiedsrichterAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A referee's own two choices on their record."""

    text_versions: FLSchiedsrichterTextVersions


class FLSeatEinwilligungPayload(BasePayload):
    """A seat holder's own two choices for every seat they hold on one row.

    Both choices on every press: a page that sent one alone would leave the other judged by nothing.
    """

    scope: FLKontaktKenntnisnahmeScope
    media: bool
    text_versions: FLSeatTextVersions
    # The row's `evidence_state` as the page was served it.
    evidence_state: FLEinwilligungStatePayload


# What a person withdraws by mail, in their words rather than a record's: the name on the website, the WhatsApp consent
# and the media consent. An address holds records of several kinds, whose `scope` means the name on some and WhatsApp
# on a seat, so a record's own two choices cannot say which the mail meant.
type FLWithdrawalChoice = Literal["name", "whatsapp", "media"]

# Each withdrawal choice as the record choice it withholds and the value it sets there: on a pupil's, a referee's and a
# registration's own record, and on a seat, whose withheld scope is the acknowledgement alone. A choice a kind holds no
# consent for is absent, and withholds nothing there.
WITHHELD_BY_A_PERSON: Final[Mapping[FLWithdrawalChoice, tuple[FLEinwilligungChoice, FLEinwilligungScope | bool]]] = {
    "name": ("scope", "internal"),
    "media": ("media", False),
}
WITHHELD_ON_A_SEAT: Final[Mapping[FLWithdrawalChoice, tuple[FLEinwilligungChoice, FLKontaktKenntnisnahmeScope | bool]]] = {
    "whatsapp": ("scope", "kontakt_data"),
    "media": ("media", False),
}

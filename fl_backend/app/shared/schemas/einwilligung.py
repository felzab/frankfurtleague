from collections.abc import Mapping
from typing import Any, ClassVar, Final, Literal, TypeAliasType, get_args, get_origin

from pydantic import BaseModel, ConfigDict
from pydantic_core import PydanticCustomError

from app.shared.einwilligung_nachweis import CHOICES, FLEinwilligungChoice, TextVersions, is_given
from app.shared.schemas.literals import FLEinwilligungUmfang, FLKontaktKenntnisnahmeUmfang
from app.shared.schemas.responses import BaseReadModel

# The label of each consent's CURRENT wording, the one a grant names: a page loaded before a deploy moved a label shows
# words a grant's record would then cite.
type FLWhatsappTextVersion = Literal["2026-11-whatsapp-1"]
type FLMedienTextVersion = Literal["2026-11-medien-1"]
type FLNameKaderTextVersion = Literal["2026-11-name-kader-1"]
type FLNameSpielplanTextVersion = Literal["2026-11-name-spielplan-1"]

# Published as schemas of their own (`app/main.py :: with_failure_responses`), though no operation names one alone: each
# label constant `fl_frontend/src/core/consentWordings.ts` sends on a grant is checked against them, so a rewording that
# moves one here and leaves the page's label behind fails the frontend's type check rather than refusing every grant.
CURRENT_TEXT_VERSIONS: Final = (FLWhatsappTextVersion, FLMedienTextVersion, FLNameKaderTextVersion, FLNameSpielplanTextVersion)

# Every label a record of each kind may cite for each choice: the current one and each it replaced. A rewording moves the
# current `Literal` above and adds the label it replaced here, so a record citing that label still reads, and a withdrawal
# from a page still showing its words is still taken: taking a consent back is never harder than giving it.
type FLSeatUmfangTextVersion = FLWhatsappTextVersion
type FLSpielerUmfangTextVersion = FLNameKaderTextVersion
type FLSchiedsrichterUmfangTextVersion = FLNameSpielplanTextVersion
# One for every kind, each showing the one media wording: three aliases of the one label would each be published
# twice, Pydantic rendering an alias another references once as its `const` and one referenced more often as a `$ref`.
type FLCitedMedienTextVersion = FLMedienTextVersion
# Every label any record cites, as `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS` keys their words, which
# that map is checked against through the published contract.
type FLEinwilligungTextVersion = (
    FLSeatUmfangTextVersion | FLSpielerUmfangTextVersion | FLSchiedsrichterUmfangTextVersion | FLCitedMedienTextVersion
)


def labels_of(alias: Any) -> frozenset[str]:
    """Every label a label alias admits, through the aliases and unions it is built of."""

    if isinstance(alias, TypeAliasType):
        return labels_of(alias.__value__)
    if get_origin(alias) is Literal:
        return frozenset(get_args(alias))

    return frozenset().union(*(labels_of(member) for member in get_args(alias)))


def _current(alias: TypeAliasType) -> str:
    (label,) = labels_of(alias)
    return label


class FLEinwilligungBeleg(BaseModel):
    """When a person set one consent choice, and under which wording."""

    # An instant in UTC (`app/core/recording.py :: log_stamp`), where the block carries a day: two
    # acts on one day are ordered by it.
    am: str
    # The words the person was shown for this choice. Any record's label on a read, and its own kind's and choice's on
    # the record model `app/readback.py` judges (`cite_their_kind`).
    text_version: FLEinwilligungTextVersion


class FLEinwilligungNachweis(FLEinwilligungBeleg, BaseReadModel):
    """The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended."""

    given_before: FLEinwilligungBeleg | None = None


class FLEinwilligungNachweise(BaseReadModel):
    """Each choice's evidence, null until its person sets it: a record no person has answered carries none."""

    umfang: FLEinwilligungNachweis | None = None
    medien: FLEinwilligungNachweis | None = None


class FLEinwilligungStand(BaseModel):
    """Each choice's stand where the account page was served, null where the record carried no evidence for it.

    A consent PATCH's precondition, echoed back as served, never a secret.
    """

    # Required with no default, as `kontakte_stand` is: an omitted precondition judges nothing.
    umfang: str | None
    medien: str | None


# As a press echoes it. Forbidden rather than ignored: a key the precondition does not compare would
# read as judged.
class FLEinwilligungStandPayload(FLEinwilligungStand):
    model_config = ConfigDict(extra="forbid")


# The labels a press was given under, one per choice, each recorded on that choice's evidence. Both on every press,
# for the payloads' reason below; one model per kind of record, whose scope wordings differ. Each admits every label
# its kind's records may cite, and `stale_grants` holds a grant to the current one.
class _TextVersions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The label a grant of each choice names.
    current: ClassVar[Mapping[FLEinwilligungChoice, str]]

    @classmethod
    def cited(cls, choice: FLEinwilligungChoice) -> frozenset[str]:
        """Every label this kind's record may cite for `choice`, read off the field's own alias."""

        return labels_of(cls.model_fields[choice].annotation)


class FLSeatTextVersions(_TextVersions):
    """A contact seat's two wordings: the WhatsApp switch and the media switch."""

    current = {"umfang": _current(FLWhatsappTextVersion), "medien": _current(FLMedienTextVersion)}

    umfang: FLSeatUmfangTextVersion
    medien: FLCitedMedienTextVersion


class FLSpielerTextVersions(_TextVersions):
    """A pupil's two wordings: the name on the squad and the media switch."""

    current = {"umfang": _current(FLNameKaderTextVersion), "medien": _current(FLMedienTextVersion)}

    umfang: FLSpielerUmfangTextVersion
    medien: FLCitedMedienTextVersion


class FLSchiedsrichterTextVersions(_TextVersions):
    """A referee's two wordings: the name on the fixtures and the media switch."""

    current = {"umfang": _current(FLNameSpielplanTextVersion), "medien": _current(FLMedienTextVersion)}

    umfang: FLSchiedsrichterUmfangTextVersion
    medien: FLCitedMedienTextVersion


type PressTextVersions = FLSeatTextVersions | FLSpielerTextVersions | FLSchiedsrichterTextVersions


def by_choice(text_versions: PressTextVersions) -> TextVersions:
    """A press's labels keyed by the choice each evidences, as the evidence writers take them."""

    return {"umfang": text_versions.umfang, "medien": text_versions.medien}


def stale_grants(text_versions: PressTextVersions, gesetzt: Mapping[FLEinwilligungChoice, Any]) -> list[FLEinwilligungChoice]:
    """The choices `gesetzt` grants under any label but their current one; a withdrawal names any its kind cites."""

    return [
        choice
        for choice, value in gesetzt.items()
        if is_given(choice, value) and getattr(text_versions, choice) != text_versions.current[choice]
    ]


def refuse_a_stale_grant(text_versions: PressTextVersions, gesetzt: Mapping[FLEinwilligungChoice, Any]) -> None:
    """A confirmation's refusal of a grant under a replaced label: every choice it sets is a first answer, so each grant moves.

    The account presses judge it in their writer instead (`app/api/account/services.py :: find_grant_wording_refusal`).
    """

    stale = stale_grants(text_versions, gesetzt)
    if stale:
        raise PydanticCustomError("grant_wording_stale", "a grant names its choice's current wording", {"choice": stale[0]})


def cite_their_kind(nachweise: FLEinwilligungNachweise, kind: type[_TextVersions]) -> FLEinwilligungNachweise:
    """Refuse evidence citing a label its kind's record never shows for that choice, as `app/readback.py` judges a record."""

    for choice in CHOICES:
        nachweis = getattr(nachweise, choice)
        belege = [] if nachweis is None else [nachweis, nachweis.given_before]
        if any(beleg is not None and beleg.text_version not in kind.cited(choice) for beleg in belege):
            raise PydanticCustomError(
                "text_version_of_another_wording", "the evidence cites a wording its choice never shows", {"choice": choice}
            )

    return nachweise


# The account presses' payloads take any label their kind cites, a grant's included: only a choice the press moves onto
# a grant must name its current one, and which choices move is the stored record's to say, which the writer reads
# (`app/api/account/crud.py :: press_einwilligung`). A page loaded before a rewording still withdraws one choice while
# leaving the other granted.
class _OwnEinwilligungPayload(BaseModel):
    # Both choices on every press, and no member defaulted: a default would let a page that forgot one
    # reset the person's other choice.
    model_config = ConfigDict(extra="forbid")

    umfang: FLEinwilligungUmfang
    medien: bool
    # The record's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload


class FLAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A pupil's or a registration's own two choices on their record."""

    text_versions: FLSpielerTextVersions


class FLSchiedsrichterAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A referee's own two choices on their record."""

    text_versions: FLSchiedsrichterTextVersions


class FLSeatEinwilligungPayload(BaseModel):
    """A seat holder's own two choices for every seat they hold on one row, under any label their kind cites.

    Both choices on every press: a page that sent one alone would leave the other judged by nothing.
    """

    model_config = ConfigDict(extra="forbid")

    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    text_versions: FLSeatTextVersions
    # The row's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload

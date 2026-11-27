import { cache } from "react";
import { notFound } from "next/navigation";

import { getAdminHolder } from "@/core/auth/guards";
import { SCHIEDSRICHTER_WORDINGS } from "@/core/consentWordings";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { deliveryChip } from "@/features/bewerbungen/deliveryState";
import { refereeChip } from "@/features/schiedsrichter/confirmationState";
import { SAVE_RULES } from "@/features/schiedsrichter/fieldRules";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saveSchiedsrichter } from "./saveSchiedsrichter";
import { reactivateSchiedsrichter, retireSchiedsrichter, sendSchiedsrichterLink } from "./schiedsrichterActs";
import { SchiedsrichterEditor } from "./SchiedsrichterEditor";
import { valuesOf } from "./schiedsrichterValues";

import type { Copy } from "@/core/copy";
import type { FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Fact } from "@/kit/Facts";
import type { Metadata } from "next";

type Props = PageProps<"/admin/schiedsrichter/[schiedsrichter]">;

const WORDS = ADMIN_COPY.schiedsrichter;
const CONSENT = ADMIN_COPY.einwilligung;

const read = cache(getSchiedsrichterById);

/** The referee the address names, retired or not: `null` for a malformed id and for one no referee holds. */
async function findSchiedsrichter(params: Props["params"]) {
  const id = await adminIdParamOf(params, "schiedsrichter");
  return id === null ? null : read(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findSchiedsrichter(params), ({ schiedsrichter }) =>
    pageMetadata(ROUTES.adminSchiedsrichterRecord, ROUTES.adminSchiedsrichterRecord.path(schiedsrichter.id), {
      title: { record: schiedsrichter.name },
    }),
  );
}

/**
 * The chips after the name, as a seat's row sets them: the state's, then what the last confirmation mail met where it
 * met trouble (`deliveryChip`), such as a complaint after a confirmed entry's delivery.
 */
function chipsOf({ schiedsrichter: referee, delivery }: FLSchiedsrichterSingleResponse): { chip: ChipProps; flag?: ChipProps } {
  const mail = deliveryChip(delivery);
  return { chip: refereeChip(referee), ...(mail === null ? {} : { flag: mail }) };
}

/**
 * Where the confirmation stands, by the day that says it: confirmed on, or the link's deadline, ahead or passed, the
 * backend judging which by the rule its press refuses on. A retired entry no link has gone to yet says nothing, its
 * return asking the person.
 */
function standingOf({ schiedsrichter: { state, einwilligung, confirmation } }: FLSchiedsrichterSingleResponse): Copy | null {
  switch (state) {
    case "confirmed":
      return einwilligung === null ? null : WORDS.confirmedOn(dayOf(einwilligung.confirmed_at));
    case "valid":
      return confirmation === null ? null : COPY.shared.answerBy(dayOf(confirmation.deadline));
    case "expired":
      return confirmation === null ? null : COPY.shared.expiredOn(dayOf(confirmation.deadline));
    case "unasked":
      return null;
  }
}

/** A confirmed referee's two answers, the name's in the words of the option chosen, as the pupil's editor shows a pupil's. */
function answerFacts({ schiedsrichter: { einwilligung } }: FLSchiedsrichterSingleResponse): Fact[] {
  if (einwilligung === null) return [];
  return [
    { label: CONSENT.nameOnSite, value: { record: SCHIEDSRICHTER_WORDINGS.scope.options[einwilligung.scope] } },
    { label: CONSENT.media, value: einwilligung.media ? CONSENT.yes : CONSENT.no },
  ];
}

/**
 * The Bestätigung's facts: where it stands, and the day the last link went, a fresh one replacing it, then what a
 * confirmed referee answered; the address and the phone stand in their own fields above, each reached from there. An
 * entry never asked has none of them, and no such block stands for it; once one holds a value both first rows stand,
 * the other a dash.
 */
function confirmationFacts(read: FLSchiedsrichterSingleResponse): Fact[] {
  const standing = standingOf(read);
  const sent = read.schiedsrichter.confirmation?.sent_at ?? null;
  if (standing === null && sent === null) return [];
  return [
    { label: COPY.shared.facts.state, value: standing ?? COPY.shared.noValue },
    {
      // The season's key, being the one label for the day any link was mailed.
      label: ADMIN_COPY.saison.sentOn,
      value: sent === null ? COPY.shared.noValue : { record: formatDate(dayOf(sent)) },
      figures: true,
    },
    ...answerFacts(read),
  ];
}

export default async function SchiedsrichterEditorPage({ params }: Props) {
  const [found, holder] = await Promise.all([findSchiedsrichter(params), getAdminHolder()]);
  if (found === null) notFound();
  const referee = found.schiedsrichter;
  const { state } = referee;
  const retired = referee.inactive_since !== null;
  // A link goes only to a live entry waiting on its answer, its link standing or lapsed, as the invite's own refusals say.
  const asking = (state === "valid" || state === "expired") && !retired;

  return (
    <SchiedsrichterEditor
      title={{ record: referee.name }}
      {...chipsOf(found)}
      record={{ id: referee.id, version: referee.version, values: valuesOf(referee) }}
      save={saveSchiedsrichter}
      holder={holder}
      rules={SAVE_RULES}
      address={state === "confirmed" ? "fixed" : "asks"}
      confirmation={confirmationFacts(found)}
      {...(asking ? { sendLink: sendSchiedsrichterLink } : {})}
      danger={
        retired
          ? { kind: "reactivate", act: reactivateSchiedsrichter, consequence: ADMIN_COPY.reactivateConsequence(WORDS.withArticle) }
          : { kind: "retire", act: retireSchiedsrichter }
      }
    />
  );
}

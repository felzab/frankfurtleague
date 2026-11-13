import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { FactsPlaceholder } from "@/kit/Facts";
import { FieldPlaceholder } from "@/kit/FieldPair";

import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { deliveryChip } from "@/features/bewerbungen/deliveryState";
import { confirmationStateOf, refereeChip } from "@/features/schiedsrichter/confirmationState";
import { SAVE_RULES } from "@/features/schiedsrichter/fieldRules";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { reactivateSchiedsrichter, retireSchiedsrichter, sendSchiedsrichterLink } from "./retireSchiedsrichter";
import { saveSchiedsrichter } from "./saveSchiedsrichter";
import { SchiedsrichterEditor } from "./SchiedsrichterEditor";
import { valuesOf } from "./schiedsrichterValues";

import type { Copy } from "@/core/copy";
import type { FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Fact } from "@/kit/Facts";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/schiedsrichter/[schiedsrichter]">;

const WORDS = COPY.admin.schiedsrichter;

/** One read of the referee by id for the tab's title and the page alike. */
const read = cache(getSchiedsrichterById);

/** The referee the address names, retired or not: `null` for a malformed id and for one no referee holds. */
async function findSchiedsrichter(params: Props["params"]) {
  const id = await adminIdParamOf(params, "schiedsrichter");
  return id === null ? null : read(id);
}

async function readSchiedsrichter(params: Props["params"]) {
  const found = await findSchiedsrichter(params);
  if (found === null) notFound();
  return found;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findSchiedsrichter(params), ({ schiedsrichter }) =>
    pageMetadata(parent, ROUTES.adminSchiedsrichterRecord, ROUTES.adminSchiedsrichterRecord.path(schiedsrichter.id), {
      title: { record: schiedsrichter.name },
    }),
  );
}

/** A referee's editor, on its one read by id and its write on the version it was read at. */
export default function SchiedsrichterEditorPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        sections: [
          [
            "field",
            "field",
            <FieldPlaceholder
              key="default_payment"
              holds={5}
              unit={COPY.shared.unit.euro}
            />,
          ],
          ["field", "field"],
          // A confirmed referee's box, as nearly every entry lands: one waiting on its answer adds its act.
          [
            <FactsPlaceholder
              key="confirmation"
              pairs={2}
            />,
          ],
        ],
        danger: [
          {
            name: COPY.shared.withObject(COPY.shared.schiedsrichter, "retire"),
            consequence: WORDS.retireConsequence,
            act: COPY.shared.verb.retire,
          },
        ],
      }}
      editor={readEditor(params)}
    />
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
 * Where the confirmation stands, by the day that says it: confirmed on, objected on, or the link's deadline, ahead or
 * passed, the backend judging which by the rule its press refuses on. A retired entry no link has gone to yet says
 * nothing, its return asking the person.
 */
function standingOf({ schiedsrichter: referee, confirmation_expired: expired }: FLSchiedsrichterSingleResponse): Copy | null {
  const { einwilligung, confirmation } = referee;
  switch (confirmationStateOf(referee)) {
    case "confirmed":
      return einwilligung === null ? null : WORDS.confirmedOn(dayOf(einwilligung.confirmed_at));
    case "objected":
      return confirmation?.declined_at == null ? null : WORDS.objectedOn(dayOf(confirmation.declined_at));
    case "unanswered":
      if (confirmation === null) return null;
      return expired ? WORDS.expiredOn(dayOf(confirmation.deadline)) : COPY.admin.spiel.answerBy(dayOf(confirmation.deadline));
    case "unasked":
      return null;
  }
}

/**
 * The Bestätigung's facts: where it stands, and the day the last link went, a fresh one replacing it; the address and
 * the phone stand in their own fields above, each reached from there. An entry never asked has neither, and no such
 * block stands for it; once one holds a value both rows stand, the other a dash.
 */
function confirmationFacts(read: FLSchiedsrichterSingleResponse): Fact[] {
  const standing = standingOf(read);
  const sent = read.schiedsrichter.confirmation?.sent_at ?? null;
  if (standing === null && sent === null) return [];
  return [
    { label: WORDS.state, value: standing ?? COPY.shared.noValue },
    {
      label: COPY.shared.toast.linkSent,
      value: sent === null ? COPY.shared.noValue : { record: formatDate(dayOf(sent)) },
      figures: true,
    },
  ];
}

async function readEditor(params: Props["params"]) {
  const found = await readSchiedsrichter(params);
  const referee = found.schiedsrichter;
  const state = confirmationStateOf(referee);
  const retired = referee.inactive_since !== null;
  // A link goes only to an entry waiting on its answer, as the invite's own refusals say: a live one with an address.
  const asking = state === "unanswered" && !retired && referee.kontakt.email !== null;

  return (
    <SchiedsrichterEditor
      title={{ record: referee.name }}
      {...chipsOf(found)}
      record={{ id: referee.id, version: referee.version, values: valuesOf(referee) }}
      save={saveSchiedsrichter}
      rules={SAVE_RULES}
      address={
        state === "confirmed" && referee.einwilligung !== null
          ? { kind: "fixed", confirmed: WORDS.confirmedOn(dayOf(referee.einwilligung.confirmed_at)) }
          : { kind: "asks" }
      }
      confirmation={confirmationFacts(found)}
      {...(asking ? { sendLink: sendSchiedsrichterLink } : {})}
      danger={
        retired
          ? { kind: "reactivate", act: reactivateSchiedsrichter, consequence: WORDS.reactivateConsequence }
          : { kind: "retire", act: retireSchiedsrichter }
      }
    />
  );
}

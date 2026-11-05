import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { COPY } from "@/core/copy";
import { dayOf, formatDatum } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { confirmationStateOf } from "@/features/schiedsrichter/confirmationState";
import { SAVE_RULES } from "@/features/schiedsrichter/fieldRules";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import { reactivateSchiedsrichter, retireSchiedsrichter, sendSchiedsrichterLink } from "./retireSchiedsrichter";
import { saveSchiedsrichter } from "./saveSchiedsrichter";
import { SchiedsrichterEditor } from "./SchiedsrichterEditor";
import { valuesOf } from "./schiedsrichterValues";

import type { Copy, Words } from "@/core/copy";
import type { FLSchiedsrichter, FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Fact } from "@/kit/Facts";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/schiedsrichter/[schiedsrichter]">;

const WORDS = COPY.admin.schiedsrichter;

/** One read of the referee by id for the tab's title and the page alike. */
const read = cache(getSchiedsrichterById);

/** The referee the address names, retired or not: not-found for a malformed id and for one no referee holds. */
async function readSchiedsrichter(params: Props["params"]) {
  const found = await read(await resolveObjectIdParam(params, "schiedsrichter"));
  if (found === null) notFound();
  return found;
}

/** A referee is named by their name; a hand-written row holding none by the glyph a missing value takes. */
const nameOf = (referee: FLSchiedsrichter): Words => (referee.name === null ? COPY.shared.noValue : { record: referee.name });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { schiedsrichter } = await readSchiedsrichter(params);
  return pageMetadata(parent, ROUTES.adminSchiedsrichterRecord, ROUTES.adminSchiedsrichterRecord.path(schiedsrichter.id), {
    title: nameOf(schiedsrichter),
  });
}

/** A referee's editor, on its one read by id and its write on the version it was read at. */
export default function SchiedsrichterEditorPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

/** The chip after the name, as the list puts it: „Stillgelegt“, or where an entry not yet confirmed stands. */
function chipOf(referee: FLSchiedsrichter): ChipProps | undefined {
  if (referee.inactive_since !== null) return { tone: "neutral", label: COPY.admin.spielort.retired };
  switch (confirmationStateOf(referee)) {
    case "confirmed":
      return undefined;
    case "objected":
      return { tone: "danger", label: SERVER_COPY.schiedsrichterConfirmation.objected };
    case "unanswered":
    case "unasked":
      return { tone: "warn", label: WORDS.unconfirmed };
  }
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
      return expired ? WORDS.expiredOn(dayOf(confirmation.frist)) : WORDS.openUntil(dayOf(confirmation.frist));
    case "unasked":
      return null;
  }
}

/**
 * The Bestätigung's facts: where it stands, and the day the last link went, a fresh one replacing it; the address and
 * the phone stand in their own fields above, each reached from there.
 */
function confirmationFacts(read: FLSchiedsrichterSingleResponse): Fact[] {
  const standing = standingOf(read);
  const sent = read.schiedsrichter.confirmation?.sent_at ?? null;
  return [
    ...(standing === null ? [] : [{ label: WORDS.state, value: standing }]),
    ...(sent === null ? [] : [{ label: WORDS.linkSent, value: { record: formatDatum(dayOf(sent)) }, figures: true }]),
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
      title={nameOf(referee)}
      chip={chipOf(referee)}
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

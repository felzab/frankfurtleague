import { cache } from "react";

import { mailedMetadata } from "@/kit/mailedLinkState";
import { MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { requires } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf, formatDate } from "@/core/format";
import { registrierungenGetConfirmationView } from "@/core/generated/client/sdk";
import { RegistrierungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";

import { ConfirmationFields } from "../ConfirmationFields";
import { linkViewOf } from "../linkView";
import { answerRegistrierung } from "./answerRegistrierung";
import { CONFIRMED, TO_HOME } from "./ends";

import type { FLRegistrierungConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/spieler">;

/** A row no crawler fetches: the URL carries the link's token. */
export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  return mailedMetadata(parent, ROUTES.registrierungConfirmation, readState(searchParams));
}

const WORDS = SERVER_COPY.registrierungConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

const { shape } = RegistrierungenPostConfirmationBody;

/** What the confirmation's write asks of the two answers, a day and a choice that post nothing while unanswered. */
const REQUIRED = { birth_date: requires(shape.birth_date, null), scope: requires(shape.scope, null) };

/**
 * `/confirm/spieler`, the link a pupil's registration mails them, on the mailed-page template: the question, with
 * „Registrierung bestätigen“; the done state; the link opened again, saying what the pupil did and on which day; and
 * the link no longer valid, an expired, mistyped or tampered link and a club out of the season alike. A pupil the
 * league already holds meets the same question as a new one.
 */
export default function RegistrierungConfirmationPage({ searchParams }: Props) {
  return <MailedPage page={readState(searchParams)} />;
}

/** The link's own read; `null` for a token no registration holds or one the backend will not parse, a dead link either way. */
// `cache` memoizes per render pass, for the tab's title and the page. Never `"use cache"`, which keys on the
// arguments rather than the caller.
const readView = cache(async (token: string): Promise<FLRegistrierungConfirmationViewResponse | null> =>
  runWithIncomingTrace(() => linkViewOf(registrierungenGetConfirmationView({ token }))),
);

/** The question: for which team, school and season the pupil registered, until when, and the answer's fields. */
function question(view: FLRegistrierungConfirmationViewResponse, token: string): MailedState {
  const until = dayOf(view.deadline);
  // Berlin's day, which the backend judges the age on.
  const today = dayIn(now());
  return {
    state: "question",
    title: COPY.page.registrierungConfirmation,
    facts: [
      { label: COPY.shared.facts.team, value: { record: view.team } },
      { label: COPY.shared.facts.school, value: { record: view.schule } },
      { label: COPY.shared.saison, value: COPY.shared.saisonName(view.saison_id) },
      { label: SERVER_COPY.kontaktConfirmation.confirmBy, value: { record: formatDate(until) } },
    ],
    sentence: WORDS.text(WORDS.opening({ record: view.team }, view.saison_id), WORDS.stored),
    more: WORDS.more,
    sentenceAfter: WORDS.deadline(until),
    action: answerRegistrierung,
    acts: { primary: COPY.page.registrierungConfirmation },
    carry: { token },
    children: (
      <ConfirmationFields
        consent={{ name: "scope", wording: SPIELER_WORDINGS.scope, isRequired: REQUIRED.scope }}
        media={SPIELER_WORDINGS.media}
        ageCheck={WORDS.ageCheck(view.minimum_age)}
        // The range the write judges, as the link's view serves it.
        earliestBirth={bornAfter(today, view.maximum_age)}
        latestBirth={bornBy(today, view.minimum_age)}
        mediaLatestBirth={bornBy(today, MEDIA_MIN_AGE)}
        isBirthDateRequired={REQUIRED.birth_date}
      />
    ),
  };
}

async function readState(searchParams: Props["searchParams"]): Promise<MailedState> {
  const { token } = await searchParams;
  // A missing or repeated parameter is no link at all.
  if (typeof token !== "string" || token === "") return INVALID;

  const view = await readView(token);
  if (view === null) return INVALID;

  switch (view.state) {
    // The view reads a lapsed link and one whose club left the season alike.
    case "expired":
      return INVALID;
    case "confirmed":
      // The view serves the answer's day on a confirmed link; one missing is a backend older than this page.
      return view.answered_at === null
        ? INVALID
        : { state: "alreadyDone", title: COPY.shared.end.doneOn(CONFIRMED.title, dayOf(view.answered_at)), next: TO_ACCOUNT };
    case "valid":
      return question(view, token);
  }
}

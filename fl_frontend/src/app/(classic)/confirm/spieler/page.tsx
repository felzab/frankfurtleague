import { cache } from "react";

import { boxRulesOf } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SPIELER_TEXT_VERSIONS, SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy/shared";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf } from "@/core/format";
import { registrierungenGetConfirmationView } from "@/core/generated/client/sdk";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage } from "@/kit/MailedPage";

import { ConfirmationFields } from "../ConfirmationFields";
import { LINK_INVALID, REGISTRIERUNG_CONFIRMED } from "../ends";
import { alreadyDone, linkViewOf } from "../linkView";
import { answerRegistrierung } from "./answerRegistrierung";

import type { FLRegistrierungConfirmationViewValid } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.registrierungConfirmation, readState());
}

const WORDS = SERVER_COPY.registrierungConfirmation;

const INVALID: MailedState = { state: "end", ...LINK_INVALID };

/**
 * `/confirm/spieler`, the link a pupil's registration mails them, on the mailed-page template: the question, with
 * „Registrierung bestätigen“; the done state; the link opened again, saying what the pupil did and on which day; and
 * the link no longer valid, an expired, mistyped or tampered link and a club out of the season alike. A pupil the
 * league already holds meets the same question as a new one.
 */
export default function RegistrierungConfirmationPage() {
  return <MailedPage page={readState()} />;
}

/** The link's own read; `null` for a token no registration holds or one the backend will not parse, a dead link either way. */
const readView = cache(async (token: string) => runWithIncomingTrace(() => linkViewOf(registrierungenGetConfirmationView({ token }))));

/** The question: for which team, school and season the pupil registered, until when, and the answer's fields. */
function question(view: FLRegistrierungConfirmationViewValid, token: string): MailedState {
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
    ],
    sentence: SERVER_COPY.paragraph(WORDS.opening({ record: view.team }, view.saison_id), WORDS.stored),
    more: WORDS.more,
    sentenceAfter: WORDS.deadline(until),
    run: answerRegistrierung,
    rules: boxRulesOf(answerRegistrierung),
    acts: { primary: COPY.page.registrierungConfirmation },
    // The labels of the wordings the page draws, so a press after a rewording is refused rather than stamped.
    carry: { token, "text_versions.scope": SPIELER_TEXT_VERSIONS.scope, "text_versions.media": SPIELER_TEXT_VERSIONS.media },
    children: (
      <ConfirmationFields
        consent={{ name: "scope", wording: SPIELER_WORDINGS.scope }}
        media={SPIELER_WORDINGS.media}
        ageCheck={WORDS.ageCheck(view.minimum_age)}
        // The range the write judges, as the link's view serves it.
        earliestBirth={bornAfter(today, view.maximum_age)}
        latestBirth={bornBy(today, view.minimum_age)}
        mediaLatestBirth={bornBy(today, MEDIA_MIN_AGE)}
      />
    ),
  };
}

async function readState(): Promise<MailedState> {
  const token = await mailedLinkToken();
  if (token === null) return INVALID;

  const view = await readView(token);
  if (view === null) return INVALID;

  switch (view.state) {
    // The view reads a lapsed link and one whose club left the season alike.
    case "expired":
      return INVALID;
    case "confirmed":
      return alreadyDone(view.answered_at, "confirmed", REGISTRIERUNG_CONFIRMED);
    case "valid":
      return question(view, token);
  }
}

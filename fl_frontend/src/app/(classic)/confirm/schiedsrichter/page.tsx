import { cache } from "react";

import { boxRulesOf } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SCHIEDSRICHTER_TEXT_VERSIONS, SCHIEDSRICHTER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy/shared";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf } from "@/core/format";
import { schiedsrichterGetConfirmationView } from "@/core/generated/client/sdk";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage } from "@/kit/MailedPage";

import { ConfirmationFields } from "../ConfirmationFields";
import { END, LINK_INVALID } from "../ends";
import { alreadyDone, linkViewOf } from "../linkView";
import { answerSchiedsrichter } from "./answerSchiedsrichter";

import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.schiedsrichterConfirmation, readState());
}

const WORDS = SERVER_COPY.schiedsrichterConfirmation;

const INVALID: MailedState = { state: "end", ...LINK_INVALID };

/**
 * `/confirm/schiedsrichter`, the link a referee's entry mails them, on the mailed-page template: the question, with
 * „Eintrag bestätigen“ and the refusal „Widersprechen“; the done states; the link opened again after a confirmation,
 * saying on which day; and the link no longer valid, an expired, mistyped or tampered link alike, and one whose entry
 * an objection erased.
 */
export default function SchiedsrichterConfirmationPage() {
  return <MailedPage page={readState()} />;
}

/** The link's own read; `null` for a token no referee holds or one the backend will not parse, a dead link either way. */
const readView = cache(async (token: string) => runWithIncomingTrace(() => linkViewOf(schiedsrichterGetConfirmationView({ token }))));

async function readState(): Promise<MailedState> {
  const token = await mailedLinkToken();
  if (token === null) return INVALID;

  const view = await readView(token);
  if (view === null) return INVALID;

  switch (view.state) {
    // The entry goes when its link lapses, so an expired one stands only until the hourly pass next erases.
    case "expired":
      return INVALID;
    case "confirmed":
      return alreadyDone(view.answered_at, "confirmed", END.confirmed);
    case "valid": {
      // Berlin's day, which the backend judges the age on.
      const today = dayIn(now());
      return {
        state: "question",
        title: COPY.page.entryConfirmation,
        // No facts rows: the link's view names no record beyond the deadline, which stands last.
        sentence: SERVER_COPY.paragraph(WORDS.opening, WORDS.stored, WORDS.objectionEffect),
        more: WORDS.more,
        sentenceAfter: SERVER_COPY.entryConfirmation.deadline(dayOf(view.deadline)),
        run: answerSchiedsrichter,
        rules: boxRulesOf(answerSchiedsrichter),
        acts: {
          primary: COPY.page.entryConfirmation,
          refusal: { verb: "oppose", subject: COPY.shared.entry, consequence: WORDS.objectionEffect },
        },
        // The labels of the wordings the page draws, so a press after a rewording is refused rather than stamped.
        carry: { token, "text_versions.scope": SCHIEDSRICHTER_TEXT_VERSIONS.scope, "text_versions.media": SCHIEDSRICHTER_TEXT_VERSIONS.media },
        children: (
          <ConfirmationFields
            consent={{ name: "scope", wording: SCHIEDSRICHTER_WORDINGS.scope }}
            media={SCHIEDSRICHTER_WORDINGS.media}
            // The range the write judges, as the link's view serves it.
            earliestBirth={bornAfter(today, view.maximum_age)}
            latestBirth={bornBy(today, view.minimum_age)}
            mediaLatestBirth={bornBy(today, MEDIA_MIN_AGE)}
          />
        ),
      };
    }
  }
}

import { cache } from "react";

import { requires } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SCHIEDSRICHTER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf } from "@/core/format";
import { schiedsrichterGetConfirmationView } from "@/core/generated/client/sdk";
import { SchiedsrichterPostConfirmationBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { mailedMetadata } from "@/kit/mailedLinkState";
import { MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { ConfirmationFields } from "../ConfirmationFields";
import { linkViewOf } from "../linkView";
import { answerSchiedsrichter } from "./answerSchiedsrichter";
import { END, TO_HOME } from "./ends";

import type { FLSchiedsrichterConfirmationViewConfirmed } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/schiedsrichter">;

export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  return mailedMetadata(parent, ROUTES.schiedsrichterConfirmation, readState(searchParams));
}

const WORDS = SERVER_COPY.schiedsrichterConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

const { shape } = SchiedsrichterPostConfirmationBody;

/** What the confirmation's write asks of the two answers, a day and a choice that post nothing while unanswered. */
const REQUIRED = { birth_date: requires(shape.birth_date, null), scope: requires(shape.scope, null) };

/**
 * `/confirm/schiedsrichter`, the link a referee's entry mails them, on the mailed-page template: the question, with
 * „Eintrag bestätigen“ and the refusal „Widersprechen“; the done states; the link opened again after a confirmation,
 * saying on which day; and the link no longer valid, an expired, mistyped or tampered link alike, and one whose entry
 * an objection erased.
 */
export default function SchiedsrichterConfirmationPage({ searchParams }: Props) {
  return <MailedPage page={readState(searchParams)} />;
}

/** The link's own read; `null` for a token no referee holds or one the backend will not parse, a dead link either way. */
const readView = cache(async (token: string) => runWithIncomingTrace(() => linkViewOf(schiedsrichterGetConfirmationView({ token }))));

/** The link opened again after its consent: on which day, with the account as the one place to go next. */
function alreadyConfirmed(view: FLSchiedsrichterConfirmationViewConfirmed): MailedState {
  return { state: "alreadyDone", title: COPY.shared.end.doneOn(END.confirmed.title, dayOf(view.answered_at)), next: TO_ACCOUNT };
}

async function readState(searchParams: Props["searchParams"]): Promise<MailedState> {
  const { token } = await searchParams;
  // A missing or repeated parameter is no link at all.
  if (typeof token !== "string" || token === "") return INVALID;

  const view = await readView(token);
  if (view === null) return INVALID;

  switch (view.state) {
    // The entry goes when its link lapses, so an expired one stands only until the hourly pass next erases.
    case "expired":
      return INVALID;
    case "confirmed":
      return alreadyConfirmed(view);
    case "valid": {
      // Berlin's day, which the backend judges the age on.
      const today = dayIn(now());
      return {
        state: "question",
        title: COPY.page.entryConfirmation,
        sentence: WORDS.question(dayOf(view.deadline)),
        action: answerSchiedsrichter,
        acts: {
          primary: COPY.page.entryConfirmation,
          refusal: { verb: "oppose", subject: COPY.shared.entry, consequence: WORDS.objectionEffect },
        },
        carry: { token },
        children: (
          <ConfirmationFields
            consent={{ name: "scope", wording: SCHIEDSRICHTER_WORDINGS.scope, isRequired: REQUIRED.scope }}
            media={SCHIEDSRICHTER_WORDINGS.media}
            // The range the write judges, as the link's view serves it.
            earliestBirth={bornAfter(today, view.maximum_age)}
            latestBirth={bornBy(today, view.minimum_age)}
            mediaLatestBirth={bornBy(today, MEDIA_MIN_AGE)}
            isBirthDateRequired={REQUIRED.birth_date}
          />
        ),
      };
    }
  }
}

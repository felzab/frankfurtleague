import { cache } from "react";

import { MAILED_PAGE_METADATA, MailedPage, mailedTitle, TO_ACCOUNT } from "@/kit/MailedPage";

import { requires } from "@/core/action";
import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { bornAfter, bornBy, dayIn, dayOf } from "@/core/format";
import { schiedsrichterGetConfirmationView } from "@/core/generated/client/sdk";
import { SchiedsrichterPostConfirmationBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { pageMetadata } from "@/shared/utils/metadata";

import { answerSchiedsrichter } from "./answerSchiedsrichter";
import { ConfirmationFields } from "./ConfirmationFields";
import { END, TO_HOME } from "./ends";

import type { FLSchiedsrichterConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/schiedsrichter">;

/** A row no crawler fetches, and no referrer: the URL carries the link's token, which stays in this address. */
export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.schiedsrichterConfirmation;
  const title = mailedTitle(await readState(searchParams), row.title);
  return { ...(await pageMetadata(parent, row, row.path(), { title })), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.schiedsrichterConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

const { shape } = SchiedsrichterPostConfirmationBody;

/** What the confirmation's write asks of the two answers, a day and a choice that post nothing while unanswered. */
const REQUIRED = { birth_date: requires(shape.birth_date, null), scope: requires(shape.scope, null) };

/**
 * `/confirm/schiedsrichter`, the link a referee's entry mails them, on the mailed-page template: the question, with
 * „Eintrag bestätigen“ and „Widersprechen“ quiet beneath it; the done states; the link opened again, saying what the
 * person did and on which day; and the link no longer valid, an expired, mistyped or tampered link and a barred
 * address alike.
 */
export default function SchiedsrichterConfirmationPage({ searchParams }: Props) {
  return (
    <MailedPage
      page={readState(searchParams)}
      act={COPY.page.entryConfirmation}
    />
  );
}

/** The link's own read; `null` for a token no referee holds or one the backend will not parse, a dead link either way. */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
const readView = cache(async (token: string): Promise<FLSchiedsrichterConfirmationViewResponse | null> =>
  runWithIncomingTrace(() =>
    schiedsrichterGetConfirmationView({ token: token }).catch((error: unknown) => {
      // A failed read is no state of the link's: it reaches the frame's error boundary, which logs it.
      if (error instanceof APIBadStatusError && (error.serverErrorCode === "link_invalid" || error.serverErrorCode === "payload_refused")) {
        return null;
      }
      throw error;
    }),
  ),
);

/** The link opened again after its answer: what the person did and on which day, with the one place to go next. */
function alreadyDone(view: FLSchiedsrichterConfirmationViewResponse, kind: "confirmed" | "objected"): MailedState {
  // The view serves the answer's day on these two states alone; one missing is a backend older than this page.
  if (view.answered_at === null) return INVALID;
  const day = dayOf(view.answered_at);
  const { title } = END[kind];
  return kind === "confirmed"
    ? { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_ACCOUNT }
    : { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_HOME, declined: true };
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
    case "barred":
      return INVALID;
    case "confirmed":
      return alreadyDone(view, "confirmed");
    case "declined":
      return alreadyDone(view, "objected");
    case "valid": {
      // Berlin's day, which the backend judges the age on.
      const today = dayIn(now());
      return {
        state: "question",
        title: COPY.page.entryConfirmation,
        sentence: WORDS.question(dayOf(view.deadline)),
        action: answerSchiedsrichter,
        acts: { primary: COPY.page.entryConfirmation, secondary: COPY.shared.verb.oppose },
        carry: { token: token },
        children: (
          <ConfirmationFields
            // The range the write judges, as the link's view serves it.
            earliestBirth={bornAfter(today, view.maximum_age)}
            latestBirth={bornBy(today, view.minimum_age)}
            mediaLatestBirth={bornBy(today, view.media_minimum_age)}
            required={REQUIRED}
          />
        ),
      };
    }
  }
}

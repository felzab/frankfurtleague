import { cache } from "react";

import { ConsentLinePlaceholder } from "@/kit/ConsentLine";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { MAILED_PAGE_METADATA, MailedPage, mailedTitle, TO_ACCOUNT } from "@/kit/MailedPage";
import { RadioGroupPlaceholder } from "@/kit/RadioGroup";

import { requires } from "@/core/action";
import { now } from "@/core/clock";
import { SCHIEDSRICHTER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import { bornAfter, bornBy, dayIn, dayOf } from "@/core/format";
import { schiedsrichterGetConfirmationView } from "@/core/generated/client/sdk";
import { SchiedsrichterPostConfirmationBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { pageMetadata } from "@/shared/utils/metadata";

import { ConfirmationFields } from "../ConfirmationFields";
import { linkViewOf } from "../linkView";
import { answerSchiedsrichter } from "./answerSchiedsrichter";
import { END, TO_HOME } from "./ends";

import type { FLSchiedsrichterConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/schiedsrichter">;

/** A row no crawler fetches, and no referrer: the URL carries the link's token, which stays in this address. */
export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.schiedsrichterConfirmation;
  const title = mailedTitle(await readState(searchParams));
  return { ...(await pageMetadata(parent, row, row.path(), { title })), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.schiedsrichterConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

const { scope } = SCHIEDSRICHTER_WORDINGS;

const { shape } = SchiedsrichterPostConfirmationBody;

/** What the confirmation's write asks of the two answers, a day and a choice that post nothing while unanswered. */
const REQUIRED = { birth_date: requires(shape.birth_date, null), scope: requires(shape.scope, null) };

/**
 * `/confirm/schiedsrichter`, the link a referee's entry mails them, on the mailed-page template: the question, with
 * „Eintrag bestätigen“ and the refusal „Widersprechen“; the done states; the link opened again, saying what the
 * person did and on which day; and the link no longer valid, an expired, mistyped or tampered link alike.
 */
export default function SchiedsrichterConfirmationPage({ searchParams }: Props) {
  return (
    <MailedPage
      page={readState(searchParams)}
      facts={0}
      act={COPY.page.entryConfirmation}
      second={COPY.shared.verb.oppose}
      // Any day's words are about as long, set unseen, so the paragraph stands as many lines as it will at every width.
      sentence={WORDS.question("2027-01-31")}
      fields={
        <>
          <FieldPlaceholder kind="date" />
          <RadioGroupPlaceholder
            label={scope.question}
            choices={[scope.options.kader_public, scope.options.internal]}
          />
          <ConsentLinePlaceholder line={scope.line} />
        </>
      }
    />
  );
}

/** The link's own read; `null` for a token no referee holds or one the backend will not parse, a dead link either way. */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
const readView = cache(async (token: string): Promise<FLSchiedsrichterConfirmationViewResponse | null> =>
  runWithIncomingTrace(() => linkViewOf(schiedsrichterGetConfirmationView({ token }))),
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
            mediaLatestBirth={bornBy(today, view.media_minimum_age)}
            isBirthDateRequired={REQUIRED.birth_date}
          />
        ),
      };
    }
  }
}

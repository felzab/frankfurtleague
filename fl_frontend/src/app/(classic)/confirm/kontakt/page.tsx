import { cache } from "react";

import { CheckboxPlaceholder } from "@/kit/Checkbox";
import { ConsentLinePlaceholder } from "@/kit/ConsentLine";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { MAILED_PAGE_METADATA, MailedPage, mailedTitle, TO_ACCOUNT } from "@/kit/MailedPage";

import { requires } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SEAT_WORDINGS } from "@/core/consentWordings";
import { COPY, rollenText } from "@/core/copy";
import { bornAfter, bornBy, dayIn, dayOf, formatDate } from "@/core/format";
import { bewerbungenGetEinwilligungView } from "@/core/generated/client/sdk";
import { BewerbungenPostEinwilligungBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { pageMetadata } from "@/shared/utils/metadata";

import { ConfirmationFields } from "../ConfirmationFields";
import { linkViewOf } from "../linkView";
import { answerKontakt, objectKontakt } from "./answerKontakt";
import { END, TO_HOME } from "./ends";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLBewerbungEinwilligungViewResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/kontakt">;

/** A row no crawler fetches, and no referrer: the URL carries the link's token, which stays in this address. */
export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.kontaktConfirmation;
  const title = mailedTitle(await readState(searchParams));
  return { ...(await pageMetadata(parent, row, row.path(), { title })), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.kontaktConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

/**
 * The question's paragraph for the wait, as an application's seat reads it, the link most mails carry, a school's name
 * standing as words about as long, and never shown: set unseen, so the paragraph stands as many lines as it will at every
 * width.
 */
const SENTENCE_WORDS = `${WORDS.text(
  WORDS.opening.named(COPY.team.fullName, "2027", { record: rollenText(["trainer"]) }),
  WORDS.stored,
  WORDS.applicationDeadline("2027-01-31"),
  WORDS.objectionEffect.application,
)} ${WORDS.more.before}${COPY.page.privacyNotice}${WORDS.more.after}`;

/** Whether the confirmation's write asks the date, which posts nothing while unanswered. */
const BIRTH_DATE_REQUIRED = requires(BewerbungenPostEinwilligungBody.options[0].shape.birth_date, null);

/**
 * `/confirm/kontakt`, the link a contact seat's mail carries, an application's or a team's season row's, on the
 * mailed-page template: the question, with „Eintrag bestätigen“ and the refusal „Widersprechen“; a closed row's
 * objection alone; the done states; the link opened again, saying what the person did and on which day; and the link no
 * longer valid, an expired, mistyped or tampered link and a decided application's seat alike.
 */
export default function KontaktConfirmationPage({ searchParams }: Props) {
  return (
    <MailedPage
      page={readState(searchParams)}
      facts={4}
      act={COPY.page.entryConfirmation}
      second={COPY.shared.verb.oppose}
      sentence={SENTENCE_WORDS}
      fields={
        <>
          <FieldPlaceholder
            kind="date"
            description={WORDS.ageCheck(18)}
          />
          <CheckboxPlaceholder label={SEAT_WORDINGS.scope.label} />
          <ConsentLinePlaceholder line={SEAT_WORDINGS.scope.line} />
        </>
      }
    />
  );
}

/** The link's own read; `null` for a token no seat holds or one the backend will not parse, a dead link either way. */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
const readView = cache(async (token: string): Promise<FLBewerbungEinwilligungViewResponse | null> =>
  runWithIncomingTrace(() => linkViewOf(bewerbungenGetEinwilligungView({ token }))),
);

/** The link opened again after its answer: what the person did and on which day, with the one place to go next. */
function alreadyDone(view: FLBewerbungEinwilligungViewResponse, kind: "confirmed" | "objected"): MailedState {
  // The view serves the answer's day on these two states alone; one missing is a backend older than this page.
  if (view.answered_at === null) return INVALID;
  const day = dayOf(view.answered_at);
  const { title } = END[kind];
  return kind === "confirmed"
    ? { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_ACCOUNT }
    : { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_HOME, declined: true };
}

/** Every seat one answer on this link writes, which the page names as the mail named them. */
const rollenOf = ({ rolle, also_rolle: also }: FLBewerbungEinwilligungViewResponse) => ({
  record: rollenText(also === null ? [rolle] : [rolle, also]),
});

/** For whom the person stands, in which season and as what: a season row's seat is entered for a team. */
const standsFor = (view: FLBewerbungEinwilligungViewResponse): Fact[] => [
  {
    label: view.quelle === "saison" ? COPY.shared.facts.team : COPY.shared.facts.school,
    value: { record: view.schule },
  },
  { label: COPY.shared.saison, value: COPY.shared.saisonName(view.saison_id) },
  { label: SERVER_COPY.mail.bewerbung.registeredAs, value: rollenOf(view) },
];

/** The objection's question, „Eintrag widersprechen?“, over what the page says an objection does to this seat. */
const objection = (consequence: Copy) => ({ verb: "oppose", subject: COPY.shared.entry, consequence }) as const;

/** A season row whose season ended or whose club left: it takes no confirmation, so the page offers the objection alone. */
function closedRow(view: FLBewerbungEinwilligungViewResponse, token: string): MailedState {
  const team = { record: view.schule };
  return {
    state: "question",
    title: WORDS.closedTitle,
    facts: standsFor(view),
    sentence: WORDS.text(
      WORDS.opening.seasonRow(team, view.saison_id, rollenOf(view)),
      WORDS.closedStored,
      view.row === "exited" ? WORDS.teamDeparted(team) : SERVER_COPY.refusalLine.saison_past,
      WORDS.objectionEffect.seasonRow,
    ),
    more: WORDS.more,
    action: objectKontakt,
    acts: { refusal: objection(WORDS.objectionEffect.seasonRow) },
    carry: { token },
  };
}

/** The question, in the words of the record the seat stands on: an application goes whole with one lapsed seat. */
function question(view: FLBewerbungEinwilligungViewResponse, token: string, until: CalendarDay): MailedState {
  const schule = { record: view.schule };
  const onSeasonRow = view.quelle === "saison";
  // Berlin's day, which the backend judges the age on.
  const today = dayIn(now());
  return {
    state: "question",
    title: COPY.page.entryConfirmation,
    facts: [...standsFor(view), { label: WORDS.confirmBy, value: { record: formatDate(until) } }],
    sentence: onSeasonRow
      ? WORDS.text(
          WORDS.opening.seasonRow(schule, view.saison_id, rollenOf(view)),
          WORDS.stored,
          WORDS.seatDeadline(until),
          WORDS.objectionEffect.seasonRow,
        )
      : WORDS.text(
          WORDS.opening.named(schule, view.saison_id, rollenOf(view)),
          WORDS.stored,
          WORDS.applicationDeadline(until),
          WORDS.objectionEffect.application,
        ),
    more: WORDS.more,
    action: answerKontakt,
    acts: {
      primary: COPY.page.entryConfirmation,
      refusal: objection(onSeasonRow ? WORDS.objectionEffect.seasonRow : WORDS.objectionEffect.application),
    },
    carry: { token },
    children: (
      <ConfirmationFields
        consent={{ name: "whatsapp", wording: SEAT_WORDINGS.scope }}
        media={SEAT_WORDINGS.media}
        ageCheck={WORDS.ageCheck(view.minimum_age)}
        // The range the write judges, as the link's view serves it.
        earliestBirth={bornAfter(today, view.maximum_age)}
        latestBirth={bornBy(today, view.minimum_age)}
        mediaLatestBirth={bornBy(today, MEDIA_MIN_AGE)}
        isBirthDateRequired={BIRTH_DATE_REQUIRED}
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
    case "expired":
      return INVALID;
    case "confirmed":
      return alreadyDone(view, "confirmed");
    case "declined":
      return alreadyDone(view, "objected");
    case "saison_past":
      return closedRow(view, token);
    // A standing seat always holds its day; one missing is a backend older than this page.
    case "valid":
      return view.deadline === null ? INVALID : question(view, token, dayOf(view.deadline));
  }
}

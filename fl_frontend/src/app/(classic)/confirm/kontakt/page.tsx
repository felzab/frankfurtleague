import { cache } from "react";

import { requires } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SEAT_WORDINGS } from "@/core/consentWordings";
import { seatsText } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf, formatDate } from "@/core/format";
import { bewerbungenGetConfirmationView } from "@/core/generated/client/sdk";
import { BewerbungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { mailedMetadata } from "@/kit/mailedLinkState";
import { MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { ConfirmationFields } from "../ConfirmationFields";
import { linkViewOf } from "../linkView";
import { answerKontakt, objectKontakt } from "./answerKontakt";
import { END, TO_HOME } from "./ends";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type {
  FLBewerbungEinwilligungViewAnswered,
  FLBewerbungEinwilligungViewSaisonPast,
  FLBewerbungEinwilligungViewValid,
} from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/kontakt">;

export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  return mailedMetadata(parent, ROUTES.kontaktConfirmation, readState(searchParams));
}

const WORDS = SERVER_COPY.kontaktConfirmation;

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

/** Whether the confirmation's write asks the date, which posts nothing while unanswered. */
const BIRTH_DATE_REQUIRED = requires(BewerbungenPostConfirmationBody.options[0].shape.birth_date, null);

/**
 * `/confirm/kontakt`, the link a contact seat's mail carries, an application's or a team's season row's, on the
 * mailed-page template: the question, with „Eintrag bestätigen“ and the refusal „Widersprechen“; a closed row's
 * objection alone; the done states; the link opened again, saying what the person did and on which day; and the link no
 * longer valid, an expired, mistyped or tampered link and a decided application's seat alike.
 */
export default function KontaktConfirmationPage({ searchParams }: Props) {
  return <MailedPage page={readState(searchParams)} />;
}

/** The link's own read; `null` for a token no seat holds or one the backend will not parse, a dead link either way. */
const readView = cache(async (token: string) => runWithIncomingTrace(() => linkViewOf(bewerbungenGetConfirmationView({ token }))));

/** The link opened again after its answer: what the person did and on which day, with the one place to go next. */
function alreadyDone(view: FLBewerbungEinwilligungViewAnswered, kind: "confirmed" | "objected"): MailedState {
  const day = dayOf(view.answered_at);
  const { title } = END[kind];
  return kind === "confirmed"
    ? { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_ACCOUNT }
    : { state: "alreadyDone", title: COPY.shared.end.doneOn(title, day), next: TO_HOME, declined: true };
}

/** A view that still names its seat: the question's, and a closed row's objection. */
type SeatView = FLBewerbungEinwilligungViewValid | FLBewerbungEinwilligungViewSaisonPast;

/** Every seat one answer on this link writes, which the page names as the mail named them. */
const seatsHeld = ({ seat, also_seat: also }: SeatView) => ({
  record: seatsText(also === null ? [seat] : [seat, also]),
});

/** For whom the person stands, in which season and as what: a season row's seat is entered for a team. */
const standsFor = (view: SeatView): Fact[] => [
  {
    label: view.record === "saison" ? COPY.shared.facts.team : COPY.shared.facts.school,
    value: { record: view.schule },
  },
  { label: COPY.shared.saison, value: COPY.shared.saisonName(view.saison_id) },
  { label: SERVER_COPY.mail.bewerbung.registeredAs, value: seatsHeld(view) },
];

/** The objection's question, „Eintrag widersprechen?“, over what the page says an objection does to this seat. */
const objection = (consequence: Copy) => ({ verb: "oppose", subject: COPY.shared.entry, consequence }) as const;

/** A season row whose season ended or whose club left: it takes no confirmation, so the page offers the objection alone. */
function closedRow(view: FLBewerbungEinwilligungViewSaisonPast, token: string): MailedState {
  const team = { record: view.schule };
  return {
    state: "question",
    title: WORDS.ownEntry,
    facts: standsFor(view),
    sentence: SERVER_COPY.paragraph(
      WORDS.opening.seasonRow(team, view.saison_id, seatsHeld(view)),
      WORDS.closedStored,
      view.row === "exited" ? WORDS.teamDeparted(team) : SERVER_COPY.refusalLine.saison_past,
      WORDS.objectionEffect.seasonRow,
    ),
    more: WORDS.more,
    run: objectKontakt,
    acts: { refusal: objection(WORDS.objectionEffect.seasonRow) },
    carry: { token },
  };
}

/** The question, in the words of the record the seat stands on: an application goes whole with one lapsed seat. */
function question(view: FLBewerbungEinwilligungViewValid, token: string, until: CalendarDay): MailedState {
  const schule = { record: view.schule };
  const onSeasonRow = view.record === "saison";
  // Berlin's day, which the backend judges the age on.
  const today = dayIn(now());
  return {
    state: "question",
    title: COPY.page.entryConfirmation,
    facts: [...standsFor(view), { label: WORDS.confirmBy, value: { record: formatDate(until) } }],
    sentence: onSeasonRow
      ? SERVER_COPY.paragraph(
          WORDS.opening.seasonRow(schule, view.saison_id, seatsHeld(view)),
          WORDS.stored,
          WORDS.seatDeadline(until),
          WORDS.objectionEffect.seasonRow,
        )
      : SERVER_COPY.paragraph(
          WORDS.opening.named(schule, view.saison_id, seatsHeld(view)),
          WORDS.stored,
          WORDS.applicationDeadline(until),
          WORDS.objectionEffect.application,
        ),
    more: WORDS.more,
    run: answerKontakt,
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
    case "valid":
      return question(view, token, dayOf(view.deadline));
  }
}

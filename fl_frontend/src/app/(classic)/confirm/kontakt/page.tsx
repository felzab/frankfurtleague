import { cache } from "react";

import { requires } from "@/core/action";
import { MEDIA_MIN_AGE } from "@/core/bounds";
import { now } from "@/core/clock";
import { SEAT_TEXT_VERSIONS, SEAT_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy/shared";
import { bornAfter, bornBy } from "@/core/dayArithmetic";
import { dayIn, dayOf } from "@/core/format";
import { bewerbungenGetConfirmationView } from "@/core/generated/client/sdk";
import { BewerbungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage } from "@/kit/MailedPage";

import { ConfirmationFields } from "../ConfirmationFields";
import { END, LINK_INVALID } from "../ends";
import { alreadyDone, linkViewOf } from "../linkView";
import { answerKontakt, objectKontakt } from "./answerKontakt";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLBewerbungEinwilligungViewSaisonPast, FLBewerbungEinwilligungViewValid } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.kontaktConfirmation, readState());
}

const WORDS = SERVER_COPY.kontaktConfirmation;

const INVALID: MailedState = { state: "end", ...LINK_INVALID };

/** Whether the confirmation's write asks the date, which posts nothing while unanswered. */
const BIRTH_DATE_REQUIRED = requires(BewerbungenPostConfirmationBody.options[0].shape.birth_date, null);

/**
 * `/confirm/kontakt`, the link a contact seat's mail carries, an application's or a team's season row's, on the
 * mailed-page template: the question, with „Eintrag bestätigen“ and the refusal „Widersprechen“; a closed row's
 * objection alone; the done states; the link opened again, saying what the person did and on which day; and the link no
 * longer valid, an expired, mistyped or tampered link and a decided application's seat alike.
 */
export default function KontaktConfirmationPage() {
  return <MailedPage page={readState()} />;
}

/** The link's own read; `null` for a token no seat holds or one the backend will not parse, a dead link either way. */
const readView = cache(async (token: string) => runWithIncomingTrace(() => linkViewOf(bewerbungenGetConfirmationView({ token }))));

/** A view that still names its seat: the question's, and a closed row's objection. */
type SeatView = FLBewerbungEinwilligungViewValid | FLBewerbungEinwilligungViewSaisonPast;

/** Every seat one answer on this link writes, which the page names as the mail named them. */
const seatsOf = ({ seat, also_seat: also }: SeatView) => (also === null ? [seat] : [seat, also]);

/**
 * For whom the person stands, in which season and as what: a season row's seat is entered for a team, which the league
 * named. An application's school is left out, as its mails leave it out: anyone sending the form types it.
 */
const standsFor = (view: SeatView): Fact[] => [
  ...(view.record === "saison" ? [{ label: COPY.shared.facts.team, value: { record: view.schule } }] : []),
  { label: COPY.shared.saison, value: COPY.shared.saisonName(view.saison_id) },
  { label: SERVER_COPY.mail.bewerbung.registeredAs, value: COPY.team.seatsHeld(seatsOf(view)) },
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
      WORDS.opening.seasonRow(team, view.saison_id, COPY.team.seatsHeld(seatsOf(view))),
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
  // A season row's team, which the league named; an application's typed school is never shown.
  const team = { record: view.schule };
  const onSeasonRow = view.record === "saison";
  const seats = COPY.team.seatsHeld(seatsOf(view));
  // Berlin's day, which the backend judges the age on.
  const today = dayIn(now());
  return {
    state: "question",
    title: COPY.page.entryConfirmation,
    facts: standsFor(view),
    sentence: onSeasonRow
      ? SERVER_COPY.paragraph(WORDS.opening.seasonRow(team, view.saison_id, seats), WORDS.stored, WORDS.objectionEffect.seasonRow)
      : SERVER_COPY.paragraph(WORDS.opening.named(view.saison_id, seats), WORDS.stored, WORDS.objectionEffect.application),
    more: WORDS.more,
    // Last, as on every confirmation: the day the answer waits for.
    sentenceAfter: onSeasonRow ? SERVER_COPY.entryConfirmation.deadline(until) : WORDS.applicationDeadline(until),
    run: answerKontakt,
    acts: {
      primary: COPY.page.entryConfirmation,
      refusal: objection(onSeasonRow ? WORDS.objectionEffect.seasonRow : WORDS.objectionEffect.application),
    },
    // The labels of the wordings the page draws, so a press after a rewording is refused rather than stamped.
    carry: { token, "text_versions.scope": SEAT_TEXT_VERSIONS.scope, "text_versions.media": SEAT_TEXT_VERSIONS.media },
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

async function readState(): Promise<MailedState> {
  const token = await mailedLinkToken();
  if (token === null) return INVALID;

  const view = await readView(token);
  if (view === null) return INVALID;

  switch (view.state) {
    case "expired":
      return INVALID;
    case "confirmed":
      return alreadyDone(view.answered_at, "confirmed", END.confirmed);
    case "declined":
      return alreadyDone(view.answered_at, "objected", END.objected);
    case "saison_past":
      return closedRow(view, token);
    case "valid":
      return question(view, token, dayOf(view.deadline));
  }
}

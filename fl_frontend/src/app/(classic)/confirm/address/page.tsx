import { cache } from "react";

import { boxRulesOf } from "@/core/action";
import { ADDRESS_CHANGE_WAITING_PERIOD } from "@/core/addressChange";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatInstantShort } from "@/core/format";
import { addressChangeGetAddressChangeView } from "@/core/generated/client/sdk";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { accountAtNewAddress } from "@/features/address-change/account";
import { readsAsDeadLink } from "@/features/address-change/refusals";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage } from "@/kit/MailedPage";

import { answerAddressChange, stopAddressChange } from "./answers";
import { confirmedAgain, doneOnEnd, LINK_INVALID, stoppedOn } from "./ends";

import type { Copy } from "@/core/copy";
import type {
  FLAddressChangeViewEnded,
  FLAddressChangeViewNew,
  FLAddressChangeViewPrevious,
  FLAddressChangeWay,
} from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";
import type { Side } from "./ends";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.addressChangeConfirmation, readState());
}

const WORDS = SERVER_COPY.addressChange;

const INVALID: MailedState = { state: "end", ...LINK_INVALID };

/** The link's read, `null` for a dead link. A failed read is no state of the link's: it reaches the frame's error boundary. */
const readChange = cache(async (token: string) =>
  runWithIncomingTrace(() =>
    addressChangeGetAddressChangeView({ token }).catch((error: unknown) => {
      if (!readsAsDeadLink(error)) throw error;
      return null;
    }),
  ),
);

const accountAtTheNewAddress = cache(async (token: string) => accountAtNewAddress({ token }));

/**
 * `/confirm/address`, both links of an address change on either way, the token saying which: a question, its done state,
 * the link opened again, or the link no longer valid. The person's own change asks the address on file first, then the
 * new mailbox; the administration's asks the new mailbox alone, the address on file holding a stop, as a holder's does
 * while its wait runs.
 */
export default function AddressChangeConfirmationPage() {
  return <MailedPage page={readState()} />;
}

async function readState(): Promise<MailedState> {
  const token = await mailedLinkToken();
  if (token === null) return INVALID;

  const view = await readChange(token);
  if (view === null) return INVALID;

  if (view.state === "ended") return endedState(view);
  return view.side === "previous" ? previousState(view, token) : newState(view, token);
}

/** A link opened after its change ended: what its holder did and when, or the link no longer valid for every other end. */
function endedState(view: FLAddressChangeViewEnded): MailedState {
  const ended = dayOf(view.ended_on);
  const released = dayOf(view.released_on);
  // The new mailbox ends it by its own answer alone; a waited change takes effect days after that answer.
  if (view.side === "new") {
    if (view.kind === "effective") return doneOnEnd("new", "confirmed", dayOf(view.confirmed_on) ?? ended, view.way);
    return view.kind === "declined" ? doneOnEnd("new", "declined", ended, view.way) : INVALID;
  }
  if (view.kind === "stopped") return stoppedOn(ended);
  // The address on file ends the person's own change by its decline, or by the change it confirmed first, whichever way
  // the new mailbox answered after.
  if (released !== null && (view.kind === "effective" || view.kind === "declined")) {
    return doneOnEnd("previous", "confirmed", released, view.way);
  }
  return view.way === "account" && view.kind === "declined" ? doneOnEnd("previous", "declined", ended, view.way) : INVALID;
}

/** The address on file's link: the person's own question, then, while the change can still be stopped, the stop. */
function previousState(view: FLAddressChangeViewPrevious, token: string): MailedState {
  if (view.state === "release_open" && view.email !== null) {
    return question({
      side: "previous",
      way: view.way,
      token,
      title: COPY.shared.withObject(WORDS.change, "confirm"),
      label: WORDS.newAddress,
      email: view.email,
      sentence: WORDS.previous.question,
    });
  }
  if (view.state === "waiting_period" || (view.state === "open" && view.way === "waiting_period")) return stop(view, token);
  // Confirmed, the person's own change waiting on the new mailbox.
  const released = dayOf(view.released_on);
  return view.state === "open" && released !== null ? doneOnEnd("previous", "confirmed", released, view.way) : INVALID;
}

async function newState(view: FLAddressChangeViewNew, token: string): Promise<MailedState> {
  if (view.state === "confirmed") {
    const confirmed = dayOf(view.confirmed_on);
    return confirmed === null ? INVALID : confirmedAgain(confirmed, view.effective_from, view.way);
  }
  // The backend cannot see the sign-in store, so its view offers the press an account at the new address closes.
  if (view.state !== "valid" || view.email === null || (await accountAtTheNewAddress(token))) return INVALID;
  return question({
    side: "new",
    way: view.way,
    token,
    title: COPY.shared.withObject(COPY.shared.emailAddress, "confirm"),
    label: COPY.shared.emailAddress,
    email: view.email,
    sentence: WORDS.new.question,
    ...(view.way === "waiting_period" ? { waits: WORDS.new.waits(ADDRESS_CHANGE_WAITING_PERIOD) } : {}),
  });
}

/** A link's question: the change's new address as the one fact, confirmed by the main act and declined by the other. */
function question({
  side,
  way,
  token,
  title,
  label,
  email,
  sentence,
  waits,
}: {
  side: Side;
  way: FLAddressChangeWay;
  token: string;
  title: Copy;
  label: Copy;
  email: string;
  sentence: Copy;
  waits?: Copy;
}): MailedState {
  return {
    state: "question",
    title,
    facts: [{ label, value: { record: email, address: true } }],
    sentence,
    ...(waits === undefined ? {} : { sentenceAfter: waits }),
    run: answerAddressChange,
    rules: boxRulesOf(answerAddressChange),
    acts: {
      primary: title,
      // Either side's decline ends the change, so the account keeps the address it has.
      refusal: { verb: "decline", subject: WORDS.change, consequence: COPY.shared.addressChange.previousStays },
    },
    carry: { token, side, way },
  };
}

/** The stop: where the change goes, as far as this link may know, and from when, once the wait runs. */
function stop({ email, effective_from: effectiveFrom }: FLAddressChangeViewPrevious, token: string): MailedState {
  const facts: Fact[] = [];
  if (email !== null) facts.push({ label: WORDS.newAddress, value: { record: email, address: true } });
  if (effectiveFrom !== null) facts.push({ label: COPY.shared.facts.effectiveFrom, value: { record: formatInstantShort(effectiveFrom) } });
  return {
    state: "question",
    title: ACCOUNT_COPY.address.stop,
    facts,
    sentence: WORDS.previous.question,
    run: stopAddressChange,
    rules: boxRulesOf(stopAddressChange),
    acts: { primary: ACCOUNT_COPY.address.stop },
    carry: { token },
  };
}

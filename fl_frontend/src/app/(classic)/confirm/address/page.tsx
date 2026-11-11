import { cache } from "react";

import { mailedMetadata } from "@/kit/mailedLinkState";
import { MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { ADDRESS_CHANGE_WAIT_DAYS } from "@/core/addressChange";
import { COPY } from "@/core/copy";
import { dayOf, formatInstantShort } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { accountAtNewAddress } from "@/features/address-change/account";
import { postAddressChangeView } from "@/features/address-change/mutations";
import { readsAsDeadLink } from "@/features/address-change/refusals";

import { answerAddressChange, stopAddressChange } from "./answers";
import { confirmedAgain, doneOnEnd, stoppedOn } from "./ends";

import type { Copy } from "@/core/copy";
import type {
  FLAddressChangeViewEnded,
  FLAddressChangeViewNew,
  FLAddressChangeViewPrevious,
  FLAddressChangeWay,
} from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";
import type { Side } from "./ends";

type Props = PageProps<"/confirm/address">;

/** A row no crawler fetches, and no referrer: the URL carries the link's token. */
export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  return mailedMetadata(parent, ROUTES.addressChangeConfirmation, readState(searchParams));
}

const WORDS = SERVER_COPY.addressChange;

const INVALID: MailedState = { state: "invalid", next: TO_ACCOUNT };

/** The link's read, `null` for a dead link. A failed read is no state of the link's: it reaches the frame's error boundary. */
// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`.
const readChange = cache(async (token: string) =>
  runWithIncomingTrace(() =>
    postAddressChangeView({ token }).catch((error: unknown) => {
      if (!readsAsDeadLink(error)) throw error;
      return null;
    }),
  ),
);

/** Whether an account stands at the new address, asked of the sign-in store once per render pass, as `readChange`. */
const accountAtTheNewAddress = cache(async (token: string) => accountAtNewAddress({ token }));

/**
 * `/confirm/address`, both links of an address change on either way, the token saying which: a question, its done state,
 * the link opened again, or the link no longer valid. The person's own change asks the address on file first, then the
 * new mailbox; the administration's asks the new mailbox alone, the address on file holding a stop, as a holder's does
 * while its wait runs.
 */
export default function AddressChangeConfirmationPage({ searchParams }: Props) {
  return (
    <MailedPage
      page={readState(searchParams)}
      facts={1}
      // The link's side is the read's, so the shorter of the two acts, which no button that lands is narrower than, and
      // the question of the address on file, asked first.
      act={COPY.shared.withObject(WORDS.change, "confirm")}
      second={COPY.shared.verb.decline}
      sentence={WORDS.previous.question}
    />
  );
}

async function readState(searchParams: Props["searchParams"]): Promise<MailedState> {
  const { token } = await searchParams;
  // A missing or repeated parameter is no link at all.
  if (typeof token !== "string" || token === "") return INVALID;

  const read = await readChange(token);
  if (read === null) return INVALID;

  const { view } = read;
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

/** The new mailbox's link. */
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
    title: COPY.shared.withObject(COPY.signIn.address, "confirm"),
    label: COPY.signIn.address,
    email: view.email,
    sentence: WORDS.new.question,
    ...(view.way === "waiting_period" ? { waits: WORDS.new.waits({ days: ADDRESS_CHANGE_WAIT_DAYS }) } : {}),
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
    action: answerAddressChange,
    acts: {
      primary: title,
      // Either side's decline ends the change, so the account keeps the address it has.
      refusal: { verb: "decline", subject: WORDS.change, consequence: COPY.admin.addressChange.previousStays },
    },
    carry: { token, side, way },
  };
}

/** The stop: where the change goes, as far as this link may know, and from when, once the wait runs. */
function stop({ email, effective_from: effectiveFrom }: FLAddressChangeViewPrevious, token: string): MailedState {
  const facts: Fact[] = [];
  if (email !== null) facts.push({ label: WORDS.newAddress, value: { record: email, address: true } });
  if (effectiveFrom !== null) facts.push({ label: COPY.admin.facts.effectiveFrom, value: { record: formatInstantShort(effectiveFrom) } });
  return {
    state: "question",
    title: COPY.account.address.stop,
    facts,
    sentence: WORDS.previous.question,
    action: stopAddressChange,
    acts: { primary: COPY.account.address.stop },
    carry: { token },
  };
}

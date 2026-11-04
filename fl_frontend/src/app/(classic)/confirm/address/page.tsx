import { ClassicPage } from "@/kit/ClassicPage";
import { MAILED_PAGE_METADATA, MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { AdresswechselLinkView } from "@/features/adresswechsel/components/views/AdresswechselLinkView";
import { accountAtNewAddress } from "@/features/adresswechsel/konto";
import { startOf, viewOf } from "@/features/adresswechsel/link";
import { postAddressChangeView } from "@/features/adresswechsel/mutations";
import { mapAddressChangeViewRefusal } from "@/features/adresswechsel/refusals";
import { pageMetadata } from "@/shared/utils/metadata";

import { answerAddressChange, verwaltungswegBeantworten } from "./answers";
import { doneOnEnd } from "./ends";

import type { Copy } from "@/core/copy";
import type { FLAddressChangeViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";
import type { Side } from "./ends";

/** A row no crawler fetches, and no referrer: the URL carries the link's token. The title fits both links. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.addressChangeConfirmation;
  return { ...(await pageMetadata(parent, row, row.path())), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.addressChange;

const INVALID: MailedState = { state: "ungueltig", next: TO_ACCOUNT };

/**
 * `/confirm/address`, both links of an address change, the token saying which: the person's own change on the
 * mailed-page template, the address on file asked first, then the new mailbox, each confirming or declining.
 */
export default function AddressChangeConfirmationPage({ searchParams }: NextPageProps) {
  return <MailedPage page={readState(searchParams)} />;
}

async function readState(searchParams: NextPageProps["searchParams"]): Promise<MailedState> {
  const { token } = await searchParams;
  // A missing or repeated parameter is no link at all.
  if (typeof token !== "string" || token === "") return INVALID;

  // A failed read is no state of the link's: it reaches the frame's error boundary, which logs it.
  const read = await runWithIncomingTrace(() =>
    postAddressChangeView({ token: token }).catch((error: unknown) => {
      if (mapAddressChangeViewRefusal(error) === null) throw error;
      return null;
    }),
  );
  if (read === null) return INVALID;

  return read.view.way === "account" ? ownWay(read.view, token) : administratorsWay(read, token);
}

/** The person's own change, in the mailed page's four states. */
async function ownWay(view: FLAddressChangeViewResponse["view"], token: string): Promise<MailedState> {
  if (view.state === "ended") {
    const ended = dayOf(view.ended_on);
    const released = dayOf(view.released_on);
    // The new mailbox ends it by its own answer alone; the address on file by its decline, or by the change it
    // confirmed first, whichever way the new mailbox answered after.
    if (view.side === "new") {
      if (view.art === "effective") return doneOnEnd("new", "confirmed", ended);
      return view.art === "declined" ? doneOnEnd("new", "declined", ended) : INVALID;
    }
    if (released !== null && (view.art === "effective" || view.art === "declined")) return doneOnEnd("previous", "confirmed", released);
    return view.art === "declined" ? doneOnEnd("previous", "declined", ended) : INVALID;
  }

  if (view.side === "previous") {
    if (view.state === "release_open" && view.email !== null) {
      return question(
        "previous",
        token,
        COPY.shared.withObject(WORDS.change, "confirm"),
        WORDS.newAddress,
        view.email,
        WORDS.previous.question,
      );
    }
    const released = dayOf(view.released_on);
    // Confirmed, the change waiting on the new mailbox; an approval a grant holder's change waits on is the old view's.
    if (view.state === "open" && released !== null) return doneOnEnd("previous", "confirmed", released);
    return view.state === "approval" ? oldView(viewOf({ view }), token) : INVALID;
  }

  // Waiting on an approval after the new mailbox confirmed: the old view's, with the approval.
  if (view.state === "confirmed" || view.state === "approval_expired") return oldView(viewOf({ view }), token);
  // The backend cannot see the sign-in store, so its view offers the press an account at the new address closes.
  if (view.state !== "valid" || view.email === null || (await accountAtNewAddress({ token: token }))) return INVALID;
  return question("new", token, COPY.shared.withObject(COPY.signIn.address, "confirm"), COPY.signIn.address, view.email, WORDS.new.question);
}

/** A link's question: the change's new address as the one fact, confirmed by the main act and declined by the other. */
function question(side: Side, token: string, title: Copy, label: Copy, email: string, sentence: Copy): MailedState {
  return {
    state: "frage",
    title: title,
    facts: [{ label: label, value: { record: email } }],
    sentence: sentence,
    action: answerAddressChange,
    acts: { primary: COPY.shared.verb.confirm, secondary: COPY.shared.verb.decline },
    carry: { token: token, side: side },
  };
}

/** Session 7: the administrator's way, which keeps the old view. */
async function administratorsWay(read: FLAddressChangeViewResponse, token: string): Promise<MailedState> {
  const gelesen = viewOf(read);
  // The backend cannot see the sign-in store, so its view offers the press an account at the new address closes.
  if (gelesen.zustand === "valid" && (await accountAtNewAddress({ token: token }))) {
    return oldView({ zustand: "not_confirmable", way: gelesen.way }, token);
  }
  return oldView(gelesen, token);
}

function oldView(gelesen: ReturnType<typeof viewOf>, token: string): MailedState {
  return {
    state: "alt",
    view: (
      <ClassicPage width="form">
        <AdresswechselLinkView
          start={startOf(gelesen, token)}
          beantworten={verwaltungswegBeantworten}
        />
      </ClassicPage>
    ),
  };
}

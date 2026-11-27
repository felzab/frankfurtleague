import { cache } from "react";
import { redirect } from "next/navigation";

import { erasureLinkStands } from "@/core/auth/accounts";
import { getAccountSession } from "@/core/auth/guards";
import { passkeysOf } from "@/core/auth/passkeys";
import { withReturnAddress } from "@/core/auth/returnAddress";
import { readRequestSession } from "@/core/auth/session";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { formatNumber } from "@/core/format";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSubjectSession } from "@/core/subject";
import { eraseAccount } from "@/features/account/personActions";
import { getErasureView } from "@/features/account/queries";
import { kaderName } from "@/features/spieler/constants";
import { linkInvalid } from "@/kit/mailedLinkState";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import type { Copy, Words } from "@/core/copy";
import type { FLAccountErasureViewResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.accountErasure, readState());
}

const WORDS = SERVER_COPY.accountErasure;
const ENTRIES = ACCOUNT_COPY.entries;

/**
 * `/erasure`, the deletion link's page: the list of what goes, and the act, for the signed-in person the link was
 * mailed to. Its already-done state is never reached: the library spends the token, and the account is gone, so a link
 * opened again reads as the link no longer valid, signed in or not. A live link alone asks a signed-out visitor to
 * sign in; another account's is refused at the press, nothing on a signed-out request naming whose it is.
 */
export default function AccountErasurePage() {
  return <MailedPage page={readState()} />;
}

const readState = cache(async (): Promise<MailedState> => {
  const token = await mailedLinkToken();
  // Judged before the session: a spent, lapsed or unknown link is a dead end a sign-in cannot repair.
  if (token === null || !(await erasureLinkStands(token))) return { state: "end", ...linkInvalid(TO_ACCOUNT) };

  // A signed-out browser signs in and returns to this page, whose cookie holds the token past the sign-in.
  const link = ROUTES.accountErasure.path();
  const subject = await getSubjectSession();
  if (subject === null) {
    return {
      state: "end",
      tone: "info",
      title: COPY.page.accountErasure,
      next: { label: COPY.shared.verb.signIn, href: withReturnAddress(ROUTES.signIn.path(), link) },
    };
  }

  // Uncaught: without the list the page cannot say what goes, so a failed read reaches the error boundary.
  const [view, served, account] = await Promise.all([getErasureView(), readRequestSession(), getAccountSession()]);
  // By the grant the address holds, never `subject.isAdmin`, which needs a passkey's session and would drop the touch
  // from an administrator's code session. Counted for a granted address alone, as no other account holds a passkey.
  const granted = subject.records.admin_tier !== null;
  const passkeys = granted && served !== null ? (await passkeysOf(served.user.id)).length : 0;

  // The act is the account's guard's to admit, which refuses an administrator's session a mailed code made. The
  // administrator's touch, which the page's press asks, makes the session it admits; one holding no passkey signs in
  // afresh by the landing, which owes the passkey step, and returns to the link, so no question is asked that its press
  // would refuse.
  if (account === null && passkeys === 0) redirect(withReturnAddress(ROUTES.signInLanding.path(), link));

  return {
    state: "question",
    title: COPY.page.accountErasure,
    facts: factsOf(subject.email, passkeys, view),
    sentence: WORDS.question,
    run: eraseAccount,
    acts: { primary: COPY.page.accountErasure, destroys: true },
    carry: { token, holder: subject.email },
    // An administrator touches a passkey at the press, on a passkey's session or a mailed code's alike.
    touch: granted,
  };
});

/** What goes, one row per label, the records the erasure view reads under it: the list a deletion erases. */
function factsOf(email: string, passkeys: number, view: FLAccountErasureViewResponse): Fact[] {
  const { spieler, schiedsrichter, seats, bewerbungen, registrierungen, address_change, admin_tier } = view;
  // One row per label, so the list reads each kind of record once: two seats held as one role name both under it.
  const records = new Map<Copy, Words[]>();
  const add = (label: Copy, record: Words) => records.set(label, [...(records.get(label) ?? []), record]);

  if (spieler !== null) add(ENTRIES.spieler, { record: kaderName(spieler) });
  for (const { name } of schiedsrichter) add(ENTRIES.schiedsrichter, { record: name });
  for (const { seat, team_name, saison_id } of seats) {
    add(ENTRIES.seats([seat]), ENTRIES.teamSeason({ record: team_name }, COPY.shared.saisonName(saison_id)));
  }
  for (const { seat, saison_id } of bewerbungen) add(ENTRIES.seats([seat]), ENTRIES.bewerbung(COPY.shared.saisonNameBound(saison_id)));
  for (const { team_name, saison_id } of registrierungen) {
    add(ENTRIES.spieler, ENTRIES.registrierung(team_name === null ? null : { record: team_name }, COPY.shared.saisonNameBound(saison_id)));
  }

  const count = (label: Copy, figure: number): Fact[] =>
    figure === 0 ? [] : [{ label, value: { record: formatNumber(figure) }, figures: true }];

  return [
    { label: COPY.shared.emailAddress, value: { record: email, address: true } },
    ...count(WORDS.passkeys, passkeys),
    ...[...records].map(([label, held]): Fact => ({
      label,
      value: held.length === 1 && held[0] !== undefined ? held[0] : ENTRIES.several(held),
    })),
    ...count(WORDS.addressChanges, address_change),
    ...(admin_tier === null ? [] : [{ label: WORDS.grant, value: COPY.shared.administration }]),
  ];
}

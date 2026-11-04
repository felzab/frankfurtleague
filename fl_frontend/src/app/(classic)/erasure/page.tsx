import { redirect } from "next/navigation";

import { MAILED_PAGE_METADATA, MailedPage, TO_ACCOUNT } from "@/kit/MailedPage";

import { erasureLinkStands } from "@/core/auth/accounts";
import { getAccountSession } from "@/core/auth/guards";
import { passkeysOf } from "@/core/auth/passkeys";
import { withReturnAddress } from "@/core/auth/returnAddress";
import { readRequestSession } from "@/core/auth/session";
import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSubjectSession } from "@/core/subject";
import { eraseAccount } from "@/features/konto/personActions";
import { getErasureView } from "@/features/konto/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Copy, Words } from "@/core/copy";
import type { FLAccountErasureViewResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata, Route } from "next";

/** A row no crawler fetches, under the mailed pages' referrer. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.accountErasure;
  return { ...(await pageMetadata(parent, row, row.path())), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.accountErasure;
const ENTRIES = COPY.account.entries;

/**
 * `/erasure`, the deletion link's page: the list of what goes, and the act, for the signed-in person the link was
 * mailed to. Its already-done state is never reached: the library spends the token, and the account is gone, so a link
 * opened again reads as the link no longer valid, signed in or not. A live link alone asks a signed-out visitor to
 * sign in; another account's is refused at the press, nothing on a signed-out request naming whose it is.
 */
export default function AccountErasurePage() {
  return <MailedPage page={readState()} />;
}

async function readState(): Promise<MailedState> {
  const token = await mailedLinkToken();
  // Judged before the session: a spent, lapsed or unknown link is a dead end a sign-in cannot repair.
  if (token === null || !(await erasureLinkStands(token))) return { state: "ungueltig", next: TO_ACCOUNT };

  // A signed-out browser signs in and returns to this page, whose cookie holds the token past the sign-in.
  const link = ROUTES.accountErasure.path();
  const subject = await getSubjectSession();
  if (subject === null) {
    return {
      state: "ende",
      tone: "info",
      title: COPY.page.accountErasure,
      sentence: WORDS.signedOut,
      next: { label: COPY.shared.verb.signIn, href: withReturnAddress(ROUTES.signIn.path(), link) as Route },
    };
  }

  // Uncaught: without the list the page cannot say what goes, so a failed read reaches the error boundary.
  const [view, served, account] = await Promise.all([getErasureView(), readRequestSession(), getAccountSession()]);
  const passkeys = served === null ? 0 : (await passkeysOf(served.user.id)).length;

  // The act is the account's guard's to admit, which refuses an administrator's session a mailed code made. A passkey
  // holder's touch, which the question asks first, makes the session it admits; an administrator holding none signs in
  // afresh by the landing, which owes the passkey step, and returns to the link, so no question is asked that its press
  // would refuse.
  if (account === null && passkeys === 0) redirect(withReturnAddress(ROUTES.signInLanding.path(), link));

  return {
    state: "frage",
    title: COPY.page.accountErasure,
    facts: factsOf(subject.email, passkeys, view),
    sentence: WORDS.question,
    action: eraseAccount,
    acts: { primary: COPY.page.accountErasure },
    carry: { token: token, holder: subject.email },
    // Every person holding a passkey touches it first, an administrator always among them.
    touch: passkeys > 0,
  };
}

/** What goes, one row per label, the records the erasure view reads under it: the list a deletion erases. */
function factsOf(email: string, passkeys: number, view: FLAccountErasureViewResponse): Fact[] {
  const { spieler, schiedsrichter, seats, bewerbungen, registrierungen, address_change, verwaltung } = view;
  // One row per label, so the list reads each kind of record once: two seats held as one role name both under it.
  const records = new Map<Copy, Words[]>();
  const add = (label: Copy, record: Words) => records.set(label, [...(records.get(label) ?? []), record]);

  for (const { vorname, nachname } of spieler) add(ENTRIES.spieler, { record: nachname === null ? vorname : `${vorname} ${nachname}` });
  for (const { name } of schiedsrichter) add(ENTRIES.schiedsrichter, name === null ? COPY.shared.notProvided : { record: name });
  for (const { rolle, team_name, saison_id } of seats) {
    add(ENTRIES.seats([rolle]), ENTRIES.teamSeason({ record: team_name }, COPY.shared.saisonName(saison_id)));
  }
  for (const { rolle, saison_id } of bewerbungen) add(ENTRIES.seats([rolle]), ENTRIES.bewerbung(COPY.shared.saisonName(saison_id)));
  for (const { team_name, saison_id } of registrierungen) {
    add(ENTRIES.spieler, ENTRIES.registrierung(team_name === null ? null : { record: team_name }, COPY.shared.saisonName(saison_id)));
  }

  const count = (label: Copy, figure: number): Fact[] =>
    figure === 0 ? [] : [{ label: label, value: { record: formatNumber(figure) }, figures: true }];

  return [
    { label: COPY.signIn.address, value: { record: email } },
    ...count(WORDS.passkeys, passkeys),
    ...[...records].map(([label, held]): Fact => ({
      label: label,
      value: held.length === 1 && held[0] !== undefined ? held[0] : ENTRIES.several(held),
    })),
    ...count(WORDS.addressChanges, address_change),
    ...(verwaltung === null ? [] : [{ label: WORDS.grant, value: COPY.verwaltung.role }]),
  ];
}

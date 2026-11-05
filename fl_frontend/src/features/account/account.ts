import "server-only";

import { redirect } from "next/navigation";

import { getAccountSession } from "@/core/auth/guards";
import { withReturnAddress } from "@/core/auth/returnAddress";
import { COPY } from "@/core/copy";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { zieleOf } from "@/features/funktionen/utils";

import type { JudgedSession } from "@/core/auth/guards";
import type { Copy } from "@/core/copy";
import type { Role } from "@/core/roles";
import type { SubjectSession } from "@/core/subject";
import type { FunktionZiel } from "@/features/funktionen/utils";
import type { Account } from "@/kit/FrameNav";
import type { MenuLink } from "@/kit/Menu";
import type { Route } from "next";

/** One place a person's Funktionen open on, as „Funktion wechseln“ lists it: a team by its name, the rest by their area. */
function entryOf(target: FunktionZiel, current: Role["kind"] | undefined): MenuLink {
  const [first] = target.funktionen;
  // An address built from the person's own records, which no literal can spell.
  const href = target.href as Route;
  const isCurrent = first.kind === current;
  switch (first.kind) {
    case "kontakt": {
      // Every seat at one address shares its team and season, so the first names both.
      const rollen = target.funktionen.flatMap((role) => (role.kind === "kontakt" ? [role.rolle] : []));
      return {
        href,
        isCurrent,
        label: { record: first.team_name },
        detail: COPY.account.role.seats(COPY.shared.saisonName(first.saison_id), rollen),
      };
    }
    case "spieler":
      return { href, isCurrent, label: COPY.shared.spieler };
    case "schiedsrichter":
      return { href, isCurrent, label: COPY.shared.schiedsrichter };
    case "administration":
      return { href, isCurrent, label: COPY.admin.role };
  }
}

/**
 * The person signed in as a frame's account row shows them: their address, `role` the area's line under it, and every
 * place their Funktionen open on, the kind `current` names marked as this area's; `null` for no session, whose page
 * sends it on. Konto, no Funktion's, marks none.
 */
export async function readAccount(role: Copy, current?: Role["kind"]): Promise<Account | null> {
  const subject = await getSubjectSession();
  if (subject === null) return null;
  return {
    role,
    address: { record: subject.email },
    roles: zieleOf(rolesOf(subject).roles).map((target) => entryOf(target, current)),
  };
}

/**
 * The signed-in person a Konto page at `path` is drawn for, and the session it is drawn under, or a redirect carrying
 * `path` back, as the proxy's turn-away does: to sign in for no session, and to the landing for an address holding a
 * grant whose session the administrator's lane refuses, which owes a fresh sign-in or its passkey step before its
 * account's acts (`fl_frontend/src/core/auth/guards.ts :: getAccountSession`), the landing sending it there. Thrown
 * inside the page, as a page's turn-away is. Both guards share this render's one session read and one lookup.
 */
export async function requireAccountSession(path: string): Promise<{ subject: SubjectSession; served: JudgedSession }> {
  const subject = await getSubjectSession();
  if (subject === null) redirect(withReturnAddress(ROUTES.signIn.path(), path));
  const served = await getAccountSession();
  if (served === null) redirect(withReturnAddress(ROUTES.signInLanding.path(), path));
  return { subject, served };
}

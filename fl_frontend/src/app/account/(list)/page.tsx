import { AccountList, AccountPage } from "@/kit/AccountPage";
import { Callout } from "@/kit/Callout";

import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { requireAccountSession } from "@/features/account/account";
import { getAccountEinwilligungen } from "@/features/account/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { ACCOUNT_ENTRIES } from "../entries";

import type { Copy } from "@/core/copy";
import type { SubjectSession } from "@/core/subject";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.account, ROUTES.account.path());
}

const { noRole } = SERVER_COPY.area;

/**
 * What stands between a person holding no Funktion and a page, `null` for a person holding one. The session says
 * whether their own records wait on their confirmation, which is theirs to give and so is said first; a confirmed
 * registration waiting on the team it names is no record of the session's, so Deine Einträge' own read says it,
 * asked of this person alone.
 */
async function noRoleOf(subject: SubjectSession): Promise<Copy | null> {
  const { roles, unconfirmed } = rolesOf(subject);
  if (roles.length > 0) return null;
  if (unconfirmed) return noRole.unconfirmed;
  // Every registration it serves is pending and confirmed: the admission deletes the row.
  const { registrierungen } = await getAccountEinwilligungen();
  return registrierungen.length > 0 ? noRole.notAdmitted : noRole.none;
}

/**
 * The list, once the session is judged, and above it, for a person holding no Funktion, whom the landing sends here,
 * what stands in the way.
 */
async function AccountListContent() {
  const { subject } = await requireAccountSession(ROUTES.account.path());
  const callout = await noRoleOf(subject);
  return (
    <>
      {callout !== null && (
        <Callout
          tone="info"
          text={callout}
        />
      )}
      <AccountList entries={ACCOUNT_ENTRIES} />
    </>
  );
}

/** Konto's list of its four pages, which a phone opens on. */
export default function AccountListPage() {
  return (
    <AccountPage route="account">
      <AccountListContent />
    </AccountPage>
  );
}

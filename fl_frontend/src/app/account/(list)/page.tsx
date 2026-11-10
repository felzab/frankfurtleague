import { AccountList, AccountListPlaceholder, AccountPage } from "@/kit/AccountPage";
import { Callout } from "@/kit/Callout";

import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { requireAccountSession } from "@/features/account/account";
import { pageMetadata } from "@/shared/utils/metadata";

import { ACCOUNT_ENTRIES } from "../entries";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.account, ROUTES.account.path());
}

/**
 * The list, once the session is judged: it reads nothing else. A person holding no Funktion, whom the landing sends
 * here, is told above it what stands in the way, as far as the session can tell.
 */
async function AccountListContent() {
  const { subject } = await requireAccountSession(ROUTES.account.path());
  const { roles, unconfirmed } = rolesOf(subject);
  return (
    <>
      {roles.length === 0 && (
        <Callout
          tone="info"
          text={unconfirmed ? SERVER_COPY.area.noRole.unconfirmed : SERVER_COPY.area.noRole.none}
        />
      )}
      <AccountList entries={ACCOUNT_ENTRIES} />
    </>
  );
}

/** Konto's list of its four pages, which a phone opens on. */
export default function AccountListPage() {
  return (
    <AccountPage
      route="account"
      wait={<AccountListPlaceholder />}>
      <AccountListContent />
    </AccountPage>
  );
}

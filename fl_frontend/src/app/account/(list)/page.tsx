import { AccountList, AccountPage } from "@/kit/AccountPage";

import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { pageMetadata } from "@/shared/utils/metadata";

import { ACCOUNT_ENTRIES } from "../entries";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.account, ROUTES.account.path());
}

/** The list, once the session is judged: it reads nothing else. */
async function AccountListContent() {
  await requireAccountSession(ROUTES.account.path());
  return <AccountList entries={ACCOUNT_ENTRIES} />;
}

/** Konto's list of its four pages, which a phone opens on. */
export default function AccountListPage() {
  return (
    <AccountPage route="account">
      <AccountListContent />
    </AccountPage>
  );
}

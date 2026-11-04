import { AccountList, AccountPage } from "@/kit/AccountPage";

import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/konto/account";
import { pageMetadata } from "@/shared/utils/metadata";

import { KONTO_ENTRIES } from "../entries";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.account, ROUTES.account.path());
}

/** The list, once the session is judged: it reads nothing else. */
async function KontoList() {
  await requireAccountSession(ROUTES.account.path());
  return <AccountList entries={KONTO_ENTRIES} />;
}

/** Konto's list of its four pages, which a phone opens on. */
export default function KontoListPage() {
  return (
    <AccountPage route="account">
      <KontoList />
    </AccountPage>
  );
}

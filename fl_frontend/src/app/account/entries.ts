import { ROUTES } from "@/core/routes";

import type { AccountEntry } from "@/kit/AccountPage";

/** Konto's four pages, the rail's entries and the phone's list alike, each by its rail glyph. */
export const KONTO_ENTRIES: readonly AccountEntry[] = [
  { id: "signin", label: ROUTES.accountSignIn.title, href: ROUTES.accountSignIn.path(), icon: "signin" },
  { id: "security", label: ROUTES.accountSecurity.title, href: ROUTES.accountSecurity.path(), icon: "key" },
  { id: "appearance", label: ROUTES.accountAppearance.title, href: ROUTES.accountAppearance.path(), icon: "appearance" },
  { id: "entries", label: ROUTES.accountEntries.title, href: ROUTES.accountEntries.path(), icon: "entries" },
];

import { AccountBox } from "@/kit/AccountBox";
import { AccountPage } from "@/kit/AccountPage";
import { ThemeChoice } from "@/kit/FrameNav";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireKontoSubject } from "@/features/konto/account";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountAppearance, ROUTES.accountAppearance.path());
}

/** The theme's box, once the session is judged: the choice is the browser's, read on no server. */
async function AppearanceContent() {
  await requireKontoSubject();
  return (
    <AccountBox
      title={COPY.page.accountAppearance}
      description={COPY.konto.appearance.description}
      control={<ThemeChoice />}
    />
  );
}

/** Darstellung: the theme, the same three glyphs as the account menu's foot, acting at once. */
export default function AccountAppearancePage() {
  return (
    <AccountPage route="accountAppearance">
      <AppearanceContent />
    </AccountPage>
  );
}

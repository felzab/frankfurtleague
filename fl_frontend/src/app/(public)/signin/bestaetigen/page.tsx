import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import { SignInTokenField } from "@/features/auth/components/ui/SignInTokenField";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as `/signin` spells it, which `fl_frontend/src/app/sitemap.test.ts` matches by path;
 * `referrer` keeps the link's token off the referer a press on „Datenschutzerklärung“ would send.
 */
export const metadata: Metadata = {
  title: "Anmeldung bestätigen",
  description: "Bestätige Deine Anmeldung zur Verwaltung der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/signin/bestaetigen"),
  alternates: { canonical: "/signin/bestaetigen" },
};

const ABSATZ_CLASSES = "fluid-sm leading-relaxed font-medium text-pretty text-foreground";

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function AnmeldungBestaetigenPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <AnmeldungBestaetigenInhalt {...props} />
    </Suspense>
  );
}

async function AnmeldungBestaetigenInhalt(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // Whether a token is there and nothing about it: reading one here would mean spending it, and the
  // whole point is that the press spends it and a mail gateway's fetch does not.
  const mitgebracht = typeof token === "string" && token !== "" ? token : null;

  return (
    <SignInCard title={mitgebracht === null ? "Link ungültig" : "Anmeldung bestätigen"}>
      {mitgebracht === null ? (
        /* One wording for a dead, a spent and an expired link: telling them apart would tell a
           guessed link whether an address it names was ever sent one. */
        <div className="flex flex-col gap-y-4">
          <p className={ABSATZ_CLASSES}>Dieser Link ist ungültig oder abgelaufen.</p>
          <Link
            href="/signin"
            prefetch={false}
            className={ctaButton({ intent: "outline", hover: "css" })}>
            Neuen Link anfordern
          </Link>
        </div>
      ) : (
        // A plain form and no submit handler: the press is the whole of the interaction, and the
        // answer is a redirect the browser follows without this page running code of its own.
        <form
          action="/api/signin/bestaetigen"
          method="post"
          className="flex flex-col gap-y-4">
          <SignInTokenField token={mitgebracht} />
          <button
            type="submit"
            className={ctaButton({ intent: "primary", hover: "css" })}>
            Jetzt anmelden
          </button>
        </form>
      )}
    </SignInCard>
  );
}

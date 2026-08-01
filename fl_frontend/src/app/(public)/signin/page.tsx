import { SignInForm } from "@/features/auth/components/forms/SignInForm";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/**
 * `noindex` rather than a canonical: this is the entrance to `/admin`, which robots.ts disallows, so
 * there is nothing here to rank. It stays out of `sitemap.ts` for the same reason — a sitemap entry
 * for a noindex URL only asks a crawler to fetch a page in order to be told to forget it.
 *
 * A route that declares no metadata inherits the root layout's, canonical included, so leaving this
 * block off would point `/signin` at the homepage.
 */
export const metadata: Metadata = {
  title: "Anmelden",
  description: "Anmeldung zum Administrationsbereich der Frankfurt-League.",
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin"),
  alternates: { canonical: "/signin" },
};

export default function SignInPage() {
  return <SignInForm />;
}

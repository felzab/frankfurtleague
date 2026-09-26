import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { SignInForm } from "@/features/auth/components/forms/SignInForm";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/**
 * `noindex`, not a canonical: this is the entrance to `/bereich` and there is nothing here to rank. A
 * route declaring no metadata inherits the root layout's, which would point `/signin` at the homepage.
 */
export const metadata: Metadata = {
  title: "Anmelden",
  description: "Anmeldung zur Verwaltung der Frankfurt League.",
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin"),
  alternates: { canonical: "/signin" },
};

export default function SignInPage() {
  return <SignInForm next={SIGN_IN_LANDING} />;
}

import { Suspense } from "react";
import { connection } from "next/server";

import { getSubjectSession } from "@/core/subject";
import { LoeschungView } from "@/features/konto/components/views/LoeschungView";
import { readGrantHolderStepUp } from "@/features/konto/loeschungStepUp";
import { getLoeschungAnsicht } from "@/features/konto/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as the confirmation pages spell it, which `fl_frontend/src/app/sitemap.test.ts` matches by
 * path; `referrer` keeps the link's token off the referer a press on any link here would send.
 */
export const metadata: Metadata = {
  title: "Konto löschen",
  description: "Bestätige die Löschung Deines Kontos bei der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/loeschung"),
  alternates: { canonical: "/loeschung" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL and the session beside it.
 */
export default function LoeschungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <LoeschungContent {...props} />
    </Suspense>
  );
}

async function LoeschungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all.
  if (typeof token !== "string" || token === "") return <LoeschungView start={{ zustand: "unvollstaendig" }} />;

  // No return destination rides the sign-in (`.claude/rules/frontend.md`'s auth clause): the person opens
  // the mailed link again once signed in.
  const subject = await getSubjectSession();
  if (subject === null) return <LoeschungView start={{ zustand: "anmelden" }} />;

  // A grant holder's press asks for the passkey first, whichever factor made the session
  // (`docs/frontend/spec.md :: I707`).
  const verwaltend = subject.subjekt.verwaltung === null ? null : await readGrantHolderStepUp();
  if (subject.subjekt.verwaltung !== null && verwaltend === null) return <LoeschungView start={{ zustand: "anmelden" }} />;
  if (verwaltend !== null && !verwaltend.hasPasskey) return <LoeschungView start={{ zustand: "ohnePasskey" }} />;

  // Uncaught: without the list the page cannot say what goes, so a failed read reaches the error boundary.
  const { spieler, schiedsrichter, sitze, bewerbungen, registrierungen, adresswechsel, verwaltung, letzter_inhaber } =
    await getLoeschungAnsicht();
  const ansicht = { spieler, schiedsrichter, sitze, bewerbungen, registrierungen, adresswechsel, verwaltung, letzter_inhaber };

  return (
    <LoeschungView
      start={{ zustand: "bereit", token: token, email: subject.email, ansicht: ansicht }}
      stepUp={verwaltend?.stepUp ?? null}
    />
  );
}

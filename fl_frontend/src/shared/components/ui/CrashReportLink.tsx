"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { KONTAKT_EMAIL } from "@/core/brand";

import { textLink } from "./textLink";

/**
 * Its own module rather than a part of either panel: both import it, and a shared leaf is what keeps
 * the dashboard's boundary from depending on the public error component.
 */
export function CrashReportLink({ digest }: { digest?: string }) {
  const pathname = usePathname();

  // Captured at mount, as close to the incident as the client can date it; click time would drift.
  const [occurredAt] = useState(() => new Date().toISOString());

  // The three coordinates `docs/logging/spec.md` asks a report to carry: a digest names an error class, so
  // the route and the time narrow it to one entry. A client crash has no digest, and saying so is the pointer.
  const reportSubject = `Fehlerbericht: ${digest ?? "Client-Fehler"} auf ${pathname}`;
  const reportBody = [
    "Hallo Frankfurt League,",
    "",
    "[Beschreibe hier kurz, was Du gerade tun wolltest und was stattdessen passiert ist.]",
    "",
    "Technische Angaben, für die Zuordnung:",
    `Digest: ${digest ?? "keiner (Client-Fehler)"}`,
    `Route: ${pathname}`,
    `Zeitpunkt: ${occurredAt}`,
  ].join("\n");
  const reportHref = `mailto:${KONTAKT_EMAIL}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`;

  return (
    /* A mailto rather than a form: the crash is already logged on both sides, so what a report adds is the
       human half, and a second public write path would guard nothing the ingest route does not. */
    <a
      href={reportHref}
      className={`${textLink({ tone: "muted" })} fluid-xs mt-6`}>
      Fehler per E-Mail melden. Die technischen Angaben sind schon ausgefüllt.
    </a>
  );
}

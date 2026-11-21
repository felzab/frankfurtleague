"use client";

// The root layout's stylesheet, which this page needs of its own: it stands in place of that layout.
import "./globals.css";

import { usePathname } from "next/navigation";

import { SITE_LOCALE } from "@/core/brand";
import { COPY } from "@/core/copy/shared";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/** The tab's title as the root layout's template words every page's. */
const TAB_TITLE = `${COPY.shared.failure.unexpected} | ${COPY.brand.name}`;

/**
 * A failure above every boundary, the root layout's own among them: Next draws this in place of the root layout, so it
 * writes its own document and draws the root boundary's card on the page's ground. Nothing the root layout holds
 * reaches it, neither the theme script nor the fonts nor the providers, so it shows in the stylesheet's light theme and
 * the system's face whatever the visitor chose. Its act is the root boundary's: a retry in place, with the way to the
 * start page beneath it but on the start page itself. Next draws it inside the router's providers, so the pathname
 * reads here as it does there. Next reads no `metadata` from this file, so the tab's title is React's `<title>`.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  const atHome = usePathname() === TO_HOME.href;
  return (
    <html lang={SITE_LOCALE}>
      {/* The root layout's body, so the card stands where the root boundary's does. */}
      <body className="flex min-h-dvh w-full flex-col bg-bg font-primary text-fg antialiased">
        <title>{TAB_TITLE}</title>
        <ClassicStatusPage
          tone="danger"
          title={COPY.shared.failure.unexpected}
          next={{ retry }}
          quiet={atHome ? undefined : TO_HOME}
        />
      </body>
    </html>
  );
}

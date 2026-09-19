"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react";

import { goBackOrPush } from "@/shared/hooks/useEditorExit";

import { DISPLAY_HEADING } from "./displayType";
import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export function NotFound() {
  const router = useRouter();

  return (
    <StatusPanel
      /* `fl_frontend/src/app/not-found.tsx` renders this inside the public shell rather than as the whole document. */
      fills="shell"
      badgeLabel="Abseits"
      heading={
        <>
          Entscheidung: <br className="sm:hidden" />
          <span className="text-foreground-muted">Kein Treffer</span>
        </>
      }
      message="Die Seite wurde verschoben oder gelöscht, oder die Adresse stimmt nicht."
      watermark={
        /* `motion-safe:` rather than the global shortening, for `fl_frontend/src/shared/components/ui/Error.tsx`'s reason. */
        <span
          className={`${DISPLAY_HEADING} text-foreground/20 sm:text-foreground/5 text-[7rem] leading-none motion-safe:animate-pulse sm:text-[15rem] md:text-[25rem] lg:text-[35rem]`}>
          404
        </span>
      }>
      {/* Written in the phone's reading order and reversed from `sm` up, for
          `fl_frontend/src/shared/components/ui/Error.tsx`'s reason. */}
      <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:mt-12 sm:flex-row-reverse sm:gap-4">
        <Link
          title="Zur Startseite"
          aria-label="Zur Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary", hover: "css" })} w-full px-8 sm:w-auto`}>
          Zur Startseite
        </Link>

        <Button
          variant="ghost"
          aria-label="Zurück zur vorherigen Seite"
          onPress={() => goBackOrPush(router, "/")}
          className={`${ctaButton({ intent: "outline", hover: "aria" })} w-full px-8 sm:w-auto`}>
          Zurück
        </Button>
      </div>
    </StatusPanel>
  );
}

import { Suspense } from "react";
import Link from "next/link";

import { BrandLink } from "@/shared/components/ui/BrandLink";

import { FooterCopyrightString } from "./FooterCopyrightString";

// serverStatusSlot is injected by the composition root rather than imported, so this generic layout
// primitive keeps zero feature dependencies. Same technique as Sidemenu's saisonMetadataDisplay.
// Not async: it awaits nothing, so the `async` only produced a promise for React to unwrap. Tested
// as a candidate cause of the PPR resume failure (ledger NEW-T2) and it is NOT the cause — the
// aborts are unchanged either way. Kept because an async function with no await is still wrong.
export function Footer({ serverStatusSlot }: { serverStatusSlot?: React.ReactNode }) {
  return (
    <footer className="max-w-page mx-auto flex h-full w-full flex-col justify-between px-4 pt-2 pb-6 sm:px-6">
      {/* Main Footer Grid */}
      <div className="border-border grid grid-cols-1 gap-8 border-b py-6 md:grid-cols-4">
        {/* Brand & Mission Column */}
        <div className="flex flex-col items-start gap-y-3 md:col-span-2">
          <BrandLink />
          <p className="text-fluid-xs text-foreground-muted max-w-sm">
            Die Frankfurter Oberstufenliga. Hier können Frankfurter Schulen gegeneinander antreten, um herauszufinden, welche die Beste ist.
          </p>
        </div>

        {/* Navigation Column */}
        <div className="flex flex-col gap-y-3">
          <h3 className="text-fluid-xs text-foreground font-semibold tracking-wider uppercase">Navigation</h3>
          <nav className="flex flex-col gap-y-2">
            <Link
              href="/about"
              prefetch={false}
              className="text-fluid-xs text-foreground-muted hover:text-brand transition-colors">
              About
            </Link>
            <Link
              href="/team"
              prefetch={false}
              className="text-fluid-xs text-foreground-muted hover:text-brand transition-colors">
              Team
            </Link>
            <Link
              href="/kontakt"
              prefetch={false}
              className="text-fluid-xs text-foreground-muted hover:text-brand transition-colors">
              Kontakt
            </Link>
          </nav>
        </div>

        {/* Socials Column */}
        <div className="flex flex-col gap-y-3">
          <h3 className="text-fluid-xs text-foreground font-semibold tracking-wider uppercase">Socials</h3>
          <div className="flex flex-wrap items-center gap-4">
            {/* Threads */}
            <Link
              href="https://www.threads.com/@frankfurt.league"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Threads-Profil"
              className="transition-opacity hover:opacity-80">
              {/* The recipe all four socials use. One masked element instead of a light/dark
                  <Image> pair: both assets were in the DOM and both were fetched, and the mask takes
                  its colour from bg-foreground, which flips with the theme on its own. The span is
                  decorative — the link above it already carries the accessible name.
                  inline-block is load-bearing: width/height do not apply to a non-replaced inline
                  box, so a bare <span class="size-6"> renders 0x0. The <Image> it replaced was a
                  replaced element, where they do apply.
                  Each *_logo_black.svg is a glyph-only silhouette, used purely as an alpha mask —
                  Instagram and WhatsApp were derived from their brand-coloured originals for this,
                  so the whole row is one colour rather than two mono icons beside two coloured
                  ones. Mask sources must have a transparent background: WhatsApp's original is a
                  filled rounded square and would have masked as a solid block. */}
              <span
                aria-hidden="true"
                className="bg-foreground inline-block size-6 mask-[url('/icons/footer/threads/threads_logo_black.svg')] mask-contain mask-center mask-no-repeat"
              />
            </Link>

            {/* GitHub */}
            <Link
              href="https://github.com/felzab"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub-Profil"
              className="transition-opacity hover:opacity-80">
              <span
                aria-hidden="true"
                className="bg-foreground inline-block size-6 mask-[url('/icons/footer/github/github_logo_black.svg')] mask-contain mask-center mask-no-repeat"
              />
            </Link>

            {/* Instagram */}
            <Link
              href="https://www.instagram.com/frankfurt.league/"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram-Profil"
              className="transition-opacity hover:opacity-80">
              <span
                aria-hidden="true"
                className="bg-foreground inline-block size-6 mask-[url('/icons/footer/instagram/instagram_logo_black.svg')] mask-contain mask-center mask-no-repeat"
              />
            </Link>

            {/* WhatsApp */}
            <Link
              href="https://whatsapp.com"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp-Kanal"
              className="transition-opacity hover:opacity-80">
              <span
                aria-hidden="true"
                className="bg-foreground inline-block size-6 mask-[url('/icons/footer/whatsapp/whatsapp_logo_black.svg')] mask-contain mask-center mask-no-repeat"
              />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Status & Copyright Bar. Both children are request-time holes in the static shell:
          the copyright year reads the clock and the status pings the backend. Each gets its own
          boundary so the shell shows a sensible fallback and the real values stream in. */}
      <div className="flex flex-col items-center justify-between gap-4 pt-6 text-center sm:flex-row sm:text-left">
        <Suspense fallback={<p className="text-fluid-xxs text-foreground-muted">{`© Frankfurt-League. Alle Rechte vorbehalten.`}</p>}>
          <FooterCopyrightString />
        </Suspense>
        <Suspense
          fallback={
            <span
              role="status"
              className="text-fluid-xxs text-foreground-muted opacity-80">
              Status wird geprüft...
            </span>
          }>
          {serverStatusSlot}
        </Suspense>
      </div>
    </footer>
  );
}

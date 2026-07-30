import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";

import { FLLogo } from "@/shared/components/ui/FLLogo";

import { FooterCopyrightString } from "./FooterCopyrightString";

// serverStatusSlot is injected by the composition root rather than imported, so this generic layout
// primitive keeps zero feature dependencies. Same technique as Sidemenu's saisonMetadataDisplay.
export default async function Footer({ serverStatusSlot }: { serverStatusSlot?: React.ReactNode }) {
  return (
    <footer className="mx-auto flex h-full w-full max-w-page flex-col justify-between px-4 pt-2 pb-6 sm:px-6">
      {/* Main Footer Grid */}
      <div className="border-border grid grid-cols-1 gap-8 border-b py-6 md:grid-cols-4">
        {/* Brand & Mission Column */}
        <div className="flex flex-col items-start gap-y-3 md:col-span-2">
          <Link
            href="/"
            title="Homepage"
            className="text-fluid-lg text-foreground flex items-center gap-2 font-bold tracking-tighter transition-opacity hover:opacity-80">
            <FLLogo />
            Frankfurt-League
          </Link>
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
              className="text-fluid-xs text-foreground-muted hover:text-foreground transition-colors">
              About
            </Link>
            <Link
              href="/team"
              prefetch={false}
              className="text-fluid-xs text-foreground-muted hover:text-foreground transition-colors">
              Team
            </Link>
            <Link
              href="/kontakt"
              prefetch={false}
              className="text-fluid-xs text-foreground-muted hover:text-foreground transition-colors">
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
              aria-label="Threads Profile"
              className="transition-opacity hover:opacity-80">
              <Image
                src="/icons/footer/threads/threads_logo_black.svg"
                alt="Threads logo"
                width={24}
                height={24}
                className="block size-6 dark:hidden"
              />
              <Image
                src="/icons/footer/threads/threads_logo_white.svg"
                alt="Threads logo"
                width={24}
                height={24}
                className="hidden size-6 dark:block"
              />
            </Link>

            {/* GitHub */}
            <Link
              href="https://github.com/felixzabb"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub Profile"
              className="transition-opacity hover:opacity-80">
              <Image
                src="/icons/footer/github/github_logo_black.svg"
                alt="GitHub logo"
                width={24}
                height={24}
                className="block size-6 dark:hidden"
              />
              <Image
                src="/icons/footer/github/github_logo_white.svg"
                alt="GitHub logo"
                width={24}
                height={24}
                className="hidden size-6 dark:block"
              />
            </Link>

            {/* Instagram */}
            <Link
              href="https://www.instagram.com/frankfurt.league/"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram Profile"
              className="transition-opacity hover:opacity-80">
              <Image
                src="/icons/footer/instagram/instagram.svg"
                alt="Instagram logo"
                width={24}
                height={24}
                className="size-6"
              />
            </Link>

            {/* WhatsApp */}
            <Link
              href="https://whatsapp.com"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp Channel"
              className="transition-opacity hover:opacity-80">
              <Image
                src="/icons/footer/whatsapp/whatsapp.svg"
                alt="WhatsApp logo"
                width={24}
                height={24}
                className="size-6"
              />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Status & Copyright Bar */}
      <div className="flex flex-col items-center justify-between gap-4 pt-6 text-center sm:flex-row sm:text-left">
        <FooterCopyrightString />
        <Suspense fallback={<span className="text-fluid-xxs text-foreground-muted opacity-80">Checking status...</span>}>
          {serverStatusSlot}
        </Suspense>
      </div>
    </footer>
  );
}

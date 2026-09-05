import { Suspense } from "react";
import Link from "next/link";

import { INSTAGRAM_URL } from "@/core/brand";
import { BrandLink } from "@/shared/components/ui/BrandLink";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

import { FooterCopyrightString } from "./FooterCopyrightString";

/**
 * `width` is sized to the string it stands in for, so nothing in the row reflows on arrival. Declared here rather than
 * imported from a feature: this is a shared layout primitive and must stay free of feature imports.
 */
function FooterSlotSkeleton({ width, label }: { width: string; label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`${skeletonBlock()} fluid-xxs inline-block rounded ${width}`}>
      &nbsp;
    </span>
  );
}

const NAVIGATION_LINKS = [
  { href: "/about", label: "About" },
  { href: "/team", label: "Team" },
  { href: "/kontakt", label: "Kontakt" },
] as const;

// A column of their own rather than the tail of Navigation: these two are reached because a reader
// went looking for them, and the pages the site is about are not.
const RECHTLICHES_LINKS = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
] as const;

/**
 * A titled column of links. Both of them render through this rather than side by side as markup, so
 * the second cannot drift from the first; `aria-label` because two `<nav>`s in one landmark are told
 * apart by name alone.
 */
function FooterNavColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-y-3">
      <h3 className="fluid-xs text-foreground font-semibold tracking-wider uppercase">{title}</h3>
      <nav
        aria-label={title}
        className="flex flex-col gap-y-2">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            className="fluid-xs text-foreground-muted hover:text-brand transition-colors">
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// `serverStatusSlot` is injected by the composition root rather than imported, so this layout primitive
// keeps zero feature dependencies — the same technique as `Sidemenu`'s `saisonMetadataDisplay`.
export function Footer({ serverStatusSlot }: { serverStatusSlot?: React.ReactNode }) {
  return (
    // `grow`, never `flex-1`: the wrapper's height is its content's, and a zero flex basis would
    // make it ask this box for a height this box is asking it for.

    // `pb-2`, not `pb-6`: the old fixed box overflowed and left eight pixels under the copyright
    // row; the floor keeps that look by stating it.
    <footer className="max-w-page mx-auto flex w-full grow flex-col justify-between px-4 pt-2 pb-2 sm:px-6">
      {/* Five tracks for four columns: the brand takes two, so each list keeps a track of its own. */}
      <div className="border-border grid grid-cols-1 gap-8 border-b py-6 md:grid-cols-5">
        <div className="flex flex-col items-start gap-y-3 md:col-span-2">
          <BrandLink />
          <p className="fluid-xs text-foreground-muted max-w-sm">
            Die Frankfurter Oberstufenliga. Hier können Frankfurter Schulen gegeneinander antreten, um herauszufinden, welche die Beste ist.
          </p>
        </div>

        <FooterNavColumn
          title="Navigation"
          links={NAVIGATION_LINKS}
        />

        <FooterNavColumn
          title="Rechtliches"
          links={RECHTLICHES_LINKS}
        />

        <div className="flex flex-col gap-y-3">
          <h3 className="fluid-xs text-foreground font-semibold tracking-wider uppercase">Socials</h3>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="https://www.threads.com/@frankfurt.league"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Threads-Profil"
              className="transition-opacity hover:opacity-80">
              {/* `inline-block` is load-bearing: width and height do not apply to a non-replaced inline box, so a
                  bare span renders 0×0. Each mask source must be a silhouette on a transparent background. */}
              <span
                aria-hidden="true"
                className="bg-foreground inline-block size-6 mask-[url('/icons/footer/threads/threads_logo_black.svg')] mask-contain mask-center mask-no-repeat"
              />
            </Link>

            <Link
              href="https://github.com/felzab/frankfurtleague"
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

            <Link
              href={INSTAGRAM_URL}
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
          </div>
        </div>
      </div>

      {/* Both children are request-time holes in the static shell, each with its own boundary. Bars rather than
          stand-in text: a fallback sentence changes its wording mid-paint and asserts something not yet known. */}
      <div className="flex flex-col items-center justify-between gap-4 pt-6 text-center sm:flex-row sm:text-left">
        <Suspense
          fallback={
            <FooterSlotSkeleton
              width="w-64"
              label="Copyright wird geladen"
            />
          }>
          <FooterCopyrightString />
        </Suspense>
        <Suspense
          fallback={
            <FooterSlotSkeleton
              width="w-28"
              label="Serverstatus wird geprüft"
            />
          }>
          {serverStatusSlot}
        </Suspense>
      </div>
    </footer>
  );
}

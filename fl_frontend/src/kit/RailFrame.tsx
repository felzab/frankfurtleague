import { Suspense } from "react";
import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { Brand } from "./Brand";
import { Chip } from "./Chip";
import { AccountRow, BackControl, BandStart, BarPlaces, RailEntries, SeasonScope } from "./FrameNav";
import { LeaveGuardProvider } from "./LeaveGuard";
import { SeasonButton } from "./SeasonButton";
import { ToastRegion } from "./Toast";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { ChipProps } from "./Chip";
import type { AccountRead, FrameSeasons, RailGroup } from "./FrameNav";

/** The rail's foot: the account signed in, which streams in, or „Anmelden“ where nobody is. */
type RailFoot = { kind: "account"; account: AccountRead } | { kind: "anmelden"; href: Route };

/** The phone bar's pages, by their entries' ids: up to four, „Mehr“ and the account taking the other places. */
type Bar = readonly [string] | readonly [string, string] | readonly [string, string, string] | readonly [string, string, string, string];

/**
 * The frame of every public season page and every signed-in area, which a layout places around its pages.
 * From 1024 px the rail stands at the left: the logo and the wordmark, the season button, the entries in
 * their groups, the foot. Below it the dark-green band stands at the top with the logo, the wordmark and the
 * season button, and the bottom bar holds the pages, „Mehr“ and the account.
 *
 * `back` is an area's own way back, as Konto's: „← Zurück“ in the logo's place in the rail's head and in the
 * band, and no bottom bar. An editor page declares its way back itself (`EditorPage`), which puts „← Zurück“
 * in the phone's band and takes the bottom bar away while it is shown, its own bar standing in that place.
 *
 * Each page's template writes its title and its content through `RailPage`, so this frame and that one write
 * the page's `h1` and `main`, and nothing else does.
 */
export function RailFrame({
  groups,
  bar,
  season,
  foot,
  back,
  children,
}: {
  groups: ReadonlyArray<RailGroup>;
  bar: Bar;
  /** The person's seasons, for the season button and the entries that are a season's pages. */
  season?: FrameSeasons;
  foot: RailFoot;
  back?: Route;
  children: ReactNode;
}) {
  const account = foot.kind === "account" ? foot.account : undefined;
  // Signed out, the phone reaches „Anmelden“ and the two legal pages through „Mehr“ (the strip carries them on desktop).
  const extra =
    foot.kind === "anmelden"
      ? [
          { label: COPY.shared.verb.anmelden, href: foot.href },
          { label: COPY.seite.impressum, href: ROUTES.impressum.pfad() },
          { label: COPY.seite.datenschutz, href: ROUTES.datenschutz.pfad() },
        ]
      : [];
  const pages = groups.flatMap((group) => group.entries.flatMap((entry) => (entry.season === undefined ? [] : [entry.season])));

  // The menus read the address and the seasons, which no prerender knows: each streams in its own boundary,
  // so the frame around them is drawn without waiting.
  const frame = (
    <LeaveGuardProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-bg-surface lg:flex">
          {/* The dark-green band heads every frame: here the rail's head, in one line with the strip. */}
          <div className="flex h-12 shrink-0 items-center bg-brand-solid px-6 text-on-brand [--focus-ring:var(--on-brand)]">
            {back === undefined ? <Brand ground="band" /> : <BackControl href={back} />}
          </div>
          <Suspense fallback={null}>
            <SeasonButton placement="rail" />
          </Suspense>
          {/* While the entries stream, the space they fill keeps the foot at the rail's end. */}
          <Suspense fallback={<div className="min-h-0 flex-1" />}>
            <RailEntries groups={groups} />
          </Suspense>
          <div className="grid shrink-0 gap-2 border-t border-border px-3 pt-2 pb-3">
            {foot.kind === "account" ? (
              // The row's height held while the session is judged, so the entries above do not move.
              <Suspense fallback={<div className="h-12" />}>
                <AccountRow account={foot.account} />
              </Suspense>
            ) : (
              <NextLink
                href={foot.href}
                data-kit-focus="ring"
                className="flex h-9 items-center rounded-lg px-3 text-sm font-medium text-fg hover:bg-bg-muted">
                {COPY.shared.verb.anmelden}
              </NextLink>
            )}
          </div>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          <header className="@container sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 bg-brand-solid px-4 text-on-brand [--focus-ring:var(--on-brand)] lg:hidden">
            <BandStart
              back={back}
              brand={<Brand ground="band" />}
            />
            <Suspense fallback={null}>
              <SeasonButton placement="band" />
            </Suspense>
          </header>
          {children}
          {back === undefined && (
            <Suspense fallback={null}>
              <BarPlaces
                groups={groups}
                bar={bar}
                extra={extra}
                account={account}
              />
            </Suspense>
          )}
        </div>
      </div>
      <ToastRegion frame="rail" />
    </LeaveGuardProvider>
  );
  return season === undefined ? frame : <SeasonScope value={{ ...season, pages }}>{frame}</SeasonScope>;
}

// The routes named by a fixed title; a record page is named by its record, a match by its two teams.
type TitledRoute = { [K in keyof typeof ROUTES]: (typeof ROUTES)[K]["titel"] extends Copy ? K : never }[keyof typeof ROUTES];

/**
 * A page's name: its route's catalogue title, a match's two teams in the fixture's order, or a record's own
 * name on its editor or read page.
 */
export type PageTitle = { route: TitledRoute } | { route: "spiel"; heim: string; gast: string } | { record: string };

function titleOf(title: PageTitle): string {
  if ("record" in title) return title.record;
  if (title.route === "spiel") return ROUTES.spiel.titel(title.heim, title.gast);
  return ROUTES[title.route].titel;
}

const strip = tv({
  slots: {
    head: "flex min-w-0 shrink-0 items-center gap-4 px-4 pt-4 lg:sticky lg:top-0 lg:z-10 lg:h-12 lg:border-b lg:border-border lg:bg-bg lg:px-8 lg:pt-0",
    heading: "min-w-0 truncate font-heading tracking-[0.02em] uppercase",
  },
  variants: {
    // A public page's title at 24 px, a signed-in page's at 20 px.
    area: {
      saison: { heading: "text-2xl" },
      bereich: { heading: "text-xl" },
    },
  },
});

/**
 * A rail page's title and content. On desktop the title stands in the 48-px strip over the content, on a
 * public season page with „Impressum“ and „Datenschutz“ at its right; on a phone it heads the content under
 * the band. The page's templates place it; `main` holds their content.
 */
export function RailPage({
  area,
  title,
  chip,
  bar,
  children,
}: {
  area: "saison" | "bereich";
  title: PageTitle;
  /** The record's status, directly after its name. */
  chip?: ChipProps;
  /** The editor's bar, at the foot of the content from the rail's separator to the edge. */
  bar?: ReactNode;
  children: ReactNode;
}) {
  const { head, heading } = strip({ area });
  return (
    <>
      <header className={head()}>
        <h1 className={heading()}>{titleOf(title)}</h1>
        {chip !== undefined && (
          <Chip
            tone={chip.tone}
            label={chip.label}
          />
        )}
        {area === "saison" && (
          <nav
            aria-label={COPY.vorlage.navigation}
            className="ms-auto hidden gap-1 lg:flex">
            {[ROUTES.impressum, ROUTES.datenschutz].map((page) => (
              <NextLink
                key={page.pfad()}
                href={page.pfad()}
                data-kit-focus="ring"
                className="flex h-9 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-fg-muted hover:text-fg">
                {page.titel}
              </NextLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-4 pb-8 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      {bar}
    </>
  );
}

/** What a template hands `RailPage`: the area and the title, and the status chip where the record has one. */
export type RailPageHead = { area: "saison" | "bereich"; title: PageTitle; chip?: ChipProps };

import { COPY, textOf } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { Brand } from "./Brand";
import { Chip } from "./Chip";
import {
  AccountRow,
  AccountRowPlaceholder,
  BackControl,
  BackPlaceholder,
  BarPlaces,
  BarPlacesPlaceholder,
  EditorBack,
  MenuScope,
  RailEntries,
  RailEntriesPlaceholder,
  ReadBack,
  SaisonScope,
} from "./FrameNav";
import { Icon } from "./Icon";
import { LeaveGuardProvider } from "./LeaveGuard";
import { frameLink, Link } from "./Link";
import { PageFade } from "./PageFade";
import { RailRoot, RailToggle, RailTooltip } from "./RailState";
import { RAIL_ID, railFade, railGlyph } from "./railStyles";
import { SaisonButton, SaisonButtonPlaceholder } from "./SaisonButton";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { ToastRegion } from "./Toast";
import { tv } from "./tv";
import { LinkHint, NavigationLink, PageWait } from "./WholePage";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";
import type { AccountRead, FrameSaisons, RailGroup } from "./FrameNav";

/** The rail's foot: the account signed in, which streams in, or „Konto“ leading to the sign-in where nobody is. */
type RailFoot = { kind: "account"; account: AccountRead } | { kind: "signIn"; href: Route };

/**
 * An area's own way back: its address, or a read of it handed down running, as the seasons and the account are, which
 * answers `null` where the person has nowhere to go back to.
 */
type Back = Route | Promise<Route | null>;

/**
 * What stands at the start of the rail's head and of the phone's band: the logo, or an area's own way back in its
 * place. A way back still being read waits as the control's own placeholder, and the logo stands where it answers none.
 */
function HeadStart({ back }: { back?: Back }) {
  const logo = <Brand ground="band" />;
  if (back === undefined) return logo;
  if (typeof back === "string") return <BackControl href={back} />;
  return (
    <PageWait fallback={<BackPlaceholder />}>
      <ReadBack
        back={back}
        none={logo}
      />
    </PageWait>
  );
}

/** The phone bar's pages, by their entries' ids: up to four, „Mehr“ and the account taking the other places. */
type Bar = readonly [string] | readonly [string, string] | readonly [string, string, string] | readonly [string, string, string, string];

/**
 * The frame of every public season page and every signed-in area, which a layout places around its pages.
 * From 1024 px the rail stands at the left: the logo and the wordmark, the season button, the entries in
 * their groups, the foot; the strip's toggle folds it to its glyphs. Below it the
 * dark-green band stands at the top with the logo, the wordmark and the season button, and the bottom bar
 * holds the pages, „Mehr“ and the account.
 *
 * `back` is an area's own way back, as Konto's: „‹ Zurück“ in the logo's place in the rail's head and in the
 * band, and no bottom bar. Where it is a read answering no address, the logo stands, and the area still has no bar.
 *
 * An area holding editors places the phone's band and bar itself, through `RailColumn` in the layout of each
 * of its route groups (`columnInLayouts`): an editor's band holds „‹ Zurück“ and no bottom bar follows, its own
 * bar standing in that place. Each page is then drawn right by the server, which knows the group from the
 * route; a page declaring it on the client would draw the bar until it hydrates, and hydrate it wrongly.
 *
 * Each page's template writes its title and its content through `RailPage`, so this frame and that one write
 * the page's `h1` and `main`, and nothing else does.
 */
export function RailFrame({
  groups,
  bar,
  saison,
  foot,
  back,
  columnInLayouts = false,
  prefetch,
  children,
}: {
  groups: ReadonlyArray<RailGroup>;
  bar: Bar;
  /** The person's seasons, or those of each team they hold, for the season button and the entries that are a season's pages. */
  saison?: FrameSaisons;
  foot: RailFoot;
  back?: Back;
  /** Whether the area's layouts place the band and the bar, each with `RailColumn`, rather than the frame. */
  columnInLayouts?: boolean;
  /**
   * Whether the menu's entries prefetch their pages whole, Next's `prefetch={true}`: for a frame of a few pages whose
   * content is cached reads every visitor shares, since each entry in view costs a server render.
   */
  prefetch?: true;
  children: ReactNode;
}) {
  const account = foot.kind === "account" ? foot.account : undefined;
  // Signed out, the phone reaches „Konto“, the way to the sign-in, and the two legal pages through „Mehr“ (the strip carries them on desktop).
  const extra =
    foot.kind === "signIn"
      ? [
          { label: COPY.template.account, href: foot.href },
          { label: COPY.page.legalNotice, href: ROUTES.legalNotice.path() },
          { label: COPY.page.privacyNotice, href: ROUTES.privacyNotice.path() },
        ]
      : [];
  const entries = groups.flatMap((group) => group.entries);

  // The menus read the address and the seasons, which no prerender knows: each streams in its own boundary,
  // so the frame around them is drawn without waiting.
  const frame = (
    <MenuScope value={{ groups, bar, extra, account, prefetch }}>
      <LeaveGuardProvider>
        <RailRoot>
          {/* Clips its parts as its width changes: each keeps its words in flow, faded, so a screen reader
              still hears every name while the rail shows glyphs alone. */}
          <aside
            id={RAIL_ID}
            className="sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-border bg-bg-surface lg:flex">
            {/* The dark-green band heads every frame: here the rail's head, in one line with the strip. */}
            <div className="flex h-(--rail-strip) shrink-0 items-center bg-brand-solid px-6 text-on-brand [--bar-ink:var(--on-brand)] [--focus-ring:var(--on-brand)]">
              <HeadStart back={back} />
            </div>
            {/* Each part the menus' reads hold back stands meanwhile as its own placeholder, at its own size, so
                nothing in the rail moves when it lands. */}
            <PageWait fallback={<SaisonButtonPlaceholder placement="rail" />}>
              <SaisonButton placement="rail" />
            </PageWait>
            <PageWait fallback={<RailEntriesPlaceholder groups={groups} />}>
              <RailEntries
                groups={groups}
                prefetch={prefetch}
              />
            </PageWait>
            <div
              className={`grid shrink-0 gap-2 border-t border-border px-3 pt-2 pb-3 ${foot.kind === "account" ? "min-h-(--rail-foot)" : ""}`}>
              {foot.kind === "account" ? (
                <PageWait fallback={<AccountRowPlaceholder />}>
                  <AccountRow account={foot.account} />
                </PageWait>
              ) : (
                // Drawn as an entry is, its glyph before its words: collapsed, the glyph alone stands centred
                // and the tooltip names it.
                <RailTooltip label={COPY.template.account}>
                  <NavigationLink
                    href={foot.href}
                    data-kit-focus="ring"
                    className={frameLink({ tone: "rail", class: "gap-3 overflow-hidden" })}>
                    <span className={railGlyph()}>
                      <Icon
                        glyph="signin"
                        size={18}
                      />
                    </span>
                    <span className={railFade()}>
                      {COPY.template.account}
                      <LinkHint />
                    </span>
                  </NavigationLink>
                </RailTooltip>
              )}
            </div>
          </aside>

          <div className="flex min-h-dvh min-w-0 flex-col">
            {/* The strip's ground, its hairline and its toggle, drawn here, in the layout a navigation keeps mounted,
                rather than by each page: they stand on every frame of a page's change and of its wait, and only the
                title `RailPage` lays over them changes. A picture of its own in a page's cross-fade, as the band is. The
                sticky box takes no height, so the title's header stands in the same 48 px over the ground it holds. */}
            <div className="sticky top-0 z-10 hidden h-0 shrink-0 lg:block">
              <div className="absolute inset-x-0 top-0 flex h-(--rail-strip) items-center border-b border-border bg-bg px-8 [view-transition-name:strip]">
                <RailToggle />
              </div>
            </div>
            {columnInLayouts ? children : <RailColumn back={back}>{children}</RailColumn>}
          </div>
          {/* Inside the rail's state, whose collapsed width its edge follows. */}
          <ToastRegion frame="rail" />
        </RailRoot>
      </LeaveGuardProvider>
    </MenuScope>
  );
  if (saison === undefined) return frame;
  // The season pages the menu lists, which a season switch from a record's page lands among: a team's in a team's frame.
  const scope =
    saison.teams === undefined
      ? { ...saison, pages: entries.flatMap((entry) => (entry.saison === undefined ? [] : [entry.saison])) }
      : { ...saison, pages: entries.flatMap((entry) => (entry.team === undefined ? [] : [entry.team])) };
  return <SaisonScope value={scope}>{frame}</SaisonScope>;
}

/**
 * A rail frame's column below 1024 px around its page: the dark-green band at the top with the logo and the
 * season button, and the bottom bar under the page. An editor's band holds „‹ Zurück“ to its list in the
 * logo's place; an area's own `back` does the same for every page of the area, and no bottom bar follows. A page
 * with a bar of its own, an editor's save, stands it in the bottom bar's place, so the bottom bar gives way to it
 * there alone: a status card or a read page at an editor's address keeps the bottom bar, as the same address's
 * not-found card does.
 */
export function RailColumn({ editor = false, back, children }: { editor?: boolean; back?: Back; children: ReactNode }) {
  return (
    <div className="group/column contents">
      {/* The band and the bar are pictures of their own in a page's cross-fade, so the page scrolled under them is
          not drawn over them (`tokens.css`). */}
      <header className="@container sticky top-0 z-20 flex h-(--rail-band) shrink-0 items-center gap-2 bg-brand-solid px-4 text-on-brand [--bar-ink:var(--on-brand)] [--focus-ring:var(--on-brand)] [view-transition-name:band] lg:hidden">
        {editor ? (
          // The list's address needs the season the rail fills in, read while the band streams.
          <PageWait fallback={<BackPlaceholder />}>
            <EditorBack />
          </PageWait>
        ) : (
          <HeadStart back={back} />
        )}
        <PageWait fallback={<SaisonButtonPlaceholder placement="band" />}>
          <SaisonButton placement="band" />
        </PageWait>
      </header>
      {children}
      {back === undefined && (
        <div className="contents group-has-[[data-kit-page-bar]]/column:hidden">
          <PageWait fallback={<BarPlacesPlaceholder />}>
            <BarPlaces />
          </PageWait>
        </div>
      )}
    </div>
  );
}

// The routes named by a fixed title; a record page is named by its record, a match by its two teams.
type TitledRoute = { [K in keyof typeof ROUTES]: (typeof ROUTES)[K]["title"] extends Copy ? K : never }[keyof typeof ROUTES];

/**
 * A page's name: its route's catalogue title, a match's two teams in the fixture's order, or a record's own
 * name on its editor or read page, as the catalogue words it or as the record holds it.
 */
export type PageTitle = { route: TitledRoute } | { route: "spiel"; team1: Words; team2: Words } | Words;

function titleOf(title: PageTitle): string {
  if (typeof title === "string" || "record" in title) return textOf(title);
  if (title.route === "spiel") return ROUTES.spiel.title(title.team1, title.team2);
  return ROUTES[title.route].title;
}

const strip = tv({
  slots: {
    // From `lg` laid over the frame's strip, as tall and as sticky, after its toggle: no ground of its own, and a
    // margin, which takes no press, where the toggle stands, 16 px past its 32-px box, 8 px more where a finger's
    // 40-px box reaches further (`RailToggle`). Its hairline's width stays in the box, unpainted, so the title is
    // centred as the strip's other parts are.
    head: "flex min-w-0 shrink-0 items-center gap-4 px-4 pt-4 [view-transition-name:title] lg:sticky lg:top-0 lg:z-10 lg:ms-12 lg:h-(--rail-strip) lg:border-b lg:border-transparent lg:ps-0 lg:pe-8 lg:pt-0 lg:pointer-coarse:ps-2",
    // A long name wraps on a phone, where the title heads the content, and is cut short only in the desktop strip.
    heading: "min-w-0 font-heading tracking-display break-words uppercase lg:truncate",
  },
  variants: {
    // A public page's title at 24 px, a signed-in page's at 20 px.
    scope: {
      saison: { heading: "text-2xl" },
      area: { heading: "text-xl" },
    },
  },
});

/**
 * The column an editor and a read page set their blocks in, inside a rail page's content: at most 760 px,
 * centred, the blocks 24 px apart.
 */
export const formColumn = tv({ base: "mx-auto grid w-full max-w-form gap-6" });

/**
 * A rail page's title and content. On desktop the title stands after the rail's toggle in the 48-px strip the frame
 * draws, which runs the full width beside the rail with its hairline continuing the rail head's edge, on a public
 * season page with „Impressum“ and „Datenschutz“ at its end; on a phone the title heads the content under the band.
 * The page's templates place it; `main` holds their content.
 */
export function RailPage({
  scope,
  title,
  chip,
  flag,
  action,
  link,
  bar,
  children,
}: {
  scope: "saison" | "area";
  /** `null` while the record naming the page is read: a bar stands in the title's place. */
  title: PageTitle | null;
  /** The record's status, directly after its name. */
  chip?: ChipProps;
  /** What that status leaves unsaid, after it. Neither chip gives way on a phone: the title takes what they leave and wraps. */
  flag?: ChipProps;
  /**
   * The page's one icon-only way on beside its title, after its chip, such as the Spielplan's magnifier to
   * the Spielsuche: the kit's link, which its tooltip names. It may wait for the page's address, as the
   * magnifier names its season, so it streams in a boundary of its own, its icon button's place held meanwhile.
   */
  action?: ReactElement;
  /**
   * A way to the record's public page, such as a match editor's to the match's own page, in words at the strip's end
   * as the strip's legal links stand; absent until the record has one. While the record is read, `waits` holds the
   * link's place by its words, so a phone's title line, as tall as the link, stands at its height before it lands.
   */
  link?: { href: Route; label: Copy } | { waits: Copy };
  /** The editor's bar, at the foot of the content from the rail's separator to the edge. */
  bar?: ReactElement;
  children: ReactNode;
}) {
  const { head, heading } = strip({ scope });
  return (
    <>
      {/* Beside the page's fade, never in it, as the bar under it is: the fade writes a name of its own over the name of
          whatever stands at its top, so each stands apart, one picture across a page's change and a wait's end
          (`tokens.css`). */}
      <header className={head()}>
        {title === null ? (
          // The title's line at the title's own height, so the content under it on a phone stands where it will.
          <Placeholder layoutClass="min-w-0 flex-1">
            <PlaceholderLine
              textClass={heading()}
              widthClass="w-48 max-w-full"
            />
          </Placeholder>
        ) : (
          <h1 className={heading()}>{titleOf(title)}</h1>
        )}
        {chip !== undefined && (
          <span className="flex shrink-0 items-center gap-2">
            <Chip {...chip} />
            {flag !== undefined && <Chip {...flag} />}
          </span>
        )}
        {action !== undefined && <PageWait fallback={<span className="size-8 shrink-0 pointer-coarse:size-10" />}>{action}</PageWait>}
        {link !== undefined &&
          ("waits" in link ? (
            <Placeholder layoutClass={frameLink({ tone: "strip", class: "ms-auto shrink-0" })}>
              <PlaceholderLine
                textClass="text-sm"
                words={link.waits}
              />
            </Placeholder>
          ) : (
            // A whole document, never Next's client navigation: the match's pop-up intercepts every client navigation to
            // its address, and the editor's way leads to the page itself.
            <span className="ms-auto flex shrink-0">
              <Link
                href={link.href}
                placement="frame"
                tone="strip"
                fullPage
                label={link.label}
              />
            </span>
          ))}
        {scope === "saison" && (
          <nav
            aria-label={COPY.template.navigation}
            className="ms-auto hidden gap-1 lg:flex">
            {[ROUTES.legalNotice, ROUTES.privacyNotice].map((page) => (
              <NavigationLink
                key={page.path()}
                href={page.path()}
                data-kit-focus="ring"
                className={frameLink({ tone: "strip" })}>
                <span>
                  {page.title}
                  <LinkHint />
                </span>
              </NavigationLink>
            ))}
          </nav>
        )}
      </header>
      <PageFade>
        {/* The content in one column of at most 1280 px, centred beside the rail on a wide screen, the gutter
            outside it; the editor's bar spans the whole width under it. */}
        <main className="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-8 overflow-anchor-none lg:px-8 lg:pt-8 lg:pb-12">
          <div className="mx-auto flex w-full max-w-content min-w-0 flex-1 flex-col gap-6">{children}</div>
        </main>
      </PageFade>
      {/* Marked, so the column leaves out the bottom bar whose place the page's own bar takes (`RailColumn`). */}
      {bar !== undefined && (
        <div
          data-kit-page-bar
          className="contents">
          {bar}
        </div>
      )}
    </>
  );
}

/**
 * What a page hands a template for the strip, drawn before the page's content is read: the area and the
 * title, the status chip where the record has one, and the way on beside the title where the page has one.
 */
export type RailPageHead = { scope: "saison" | "area"; title: PageTitle; chip?: ChipProps; action?: ReactElement };

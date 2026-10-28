"use client";

import { createContext, Fragment, Suspense, use, useContext } from "react";
import NextLink from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";

import { useTheme } from "next-themes";
import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";
import { signOut } from "@/shared/utils/signOut";

import { Segmented } from "./ChoiceButtons";
import { ConfirmDialog } from "./ConfirmDialog";
import { entryMark } from "./fieldStyles";
import { Icon } from "./Icon";
import { useLeaveGuard } from "./LeaveGuard";
import { frameLink, menuEntry } from "./Link";
import { Menu } from "./Menu";
import { RailTooltip } from "./RailState";
import { railFade, railGlyph } from "./railStyles";
import { groupHeading } from "./Section";
import { Sheet } from "./Sheet";
import { appToast } from "./Toast";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { GlyphChoice } from "./ChoiceButtons";
import type { IconName } from "./Icon";

/** A page every season holds once, by its route in the table: a route whose address takes the season alone. */
export type SeasonPage = {
  [K in keyof typeof ROUTES]: Parameters<(typeof ROUTES)[K]["pfad"]> extends [string] ? K : never;
}[keyof typeof ROUTES];

/**
 * One page a frame's menu leads to: its name, its glyph in the rail and in the phone bar, and its address, or
 * the season's page it is, whose address the frame fills in with the season the page works in.
 */
type RailEntry = { id: string; label: Copy; icon: IconName } & ({ href: Route; season?: never } | { season: SeasonPage; href?: never });

/** Entries the rail sets together under one heading; the first group of an area may stand without one. */
export type RailGroup = { heading?: Copy; entries: ReadonlyArray<RailEntry> };

/** The seasons a person may switch between, the newest first, and the one a page whose address names none works in. */
export type Seasons = {
  /** Each season's id, and its span as `formatZeitraum` writes it on the server, which the rail's button shows under the name. */
  entries: ReadonlyArray<{ id: string; span: string }>;
  standard: string;
};

/**
 * A frame's seasons, read for the frame and handed down unawaited, so the frame streams before the read
 * settles; `null` where the person has no season yet.
 */
export type FrameSeasons = {
  seasons: Promise<Seasons | null>;
  /** The season's first page, where a switch from a page with no counterpart in the other season lands. */
  home: SeasonPage;
  /** Where a season's page is reached while there is no season at all. */
  withoutSeason?: Route;
};

const SeasonContext = createContext<(FrameSeasons & { pages: readonly SeasonPage[] }) | null>(null);

/** Hands the frame's seasons and its season pages to its menus, which a layout's server code cannot reach. */
export function SeasonScope({ value, children }: { value: FrameSeasons & { pages: readonly SeasonPage[] }; children: ReactNode }) {
  return <SeasonContext value={value}>{children}</SeasonContext>;
}

/** A route's dynamic segments as Next fills them in from the address. */
type Params = ReturnType<typeof useParams>;

/** The season the page works in: the one its address names, else the frame's standard; `null` where there is none. */
export function useFrameSeason() {
  const frame = useContext(SeasonContext);
  const { saison } = useParams();
  const seasons = frame === null ? null : use(frame.seasons);
  if (frame === null || seasons === null) return null;
  return { ...frame, ...seasons, active: typeof saison === "string" ? saison : seasons.standard };
}

/**
 * The same page in season `to`: the address with its season swapped. A record's page, an address naming a
 * record past the season, has no counterpart there and lands on the list it lies under, the season page the
 * rail marks for it; a page whose address names no season lands on the season's first page.
 */
export function counterpart({
  path,
  params,
  to,
  home,
  pages,
}: {
  path: string;
  params: Params;
  to: string;
  home: SeasonPage;
  pages: readonly SeasonPage[];
}): Route {
  const from = params.saison;
  const segments = path.split("/");
  const at = typeof from === "string" ? segments.indexOf(from) : -1;
  if (typeof from !== "string" || at === -1) return ROUTES[home].pfad(to);

  const records = Object.entries(params).flatMap(([name, value]) => (name === "saison" || value === undefined ? [] : [value].flat()));
  if (segments.slice(at + 1).some((segment) => records.includes(segment))) {
    const lists = pages.map((page) => ({ page, href: ROUTES[page].pfad(from) }));
    const list = lists.find(
      (each) =>
        each.href ===
        currentOf(
          path,
          lists.map((one) => one.href),
        ),
    );
    return ROUTES[list?.page ?? home].pfad(to);
  }

  segments[at] = to;
  // An address built from the one the page answers at, which no literal can spell.
  return segments.join("/") as Route;
}

/** The entries with their addresses, a season's page in the season the page works in; one with no address is left out. */
function useEntries(groups: ReadonlyArray<RailGroup>) {
  const frame = useContext(SeasonContext);
  const season = useFrameSeason();
  const hrefOf = (entry: RailEntry): Route | undefined => {
    if (entry.season === undefined) return entry.href;
    return season === null ? frame?.withoutSeason : ROUTES[entry.season].pfad(season.active);
  };
  return groups
    .map((group) => ({
      heading: group.heading,
      entries: group.entries.flatMap((entry) => {
        const href = hrefOf(entry);
        return href === undefined ? [] : [{ id: entry.id, label: entry.label, icon: entry.icon, href }];
      }),
    }))
    .filter((group) => group.entries.length > 0);
}

/** The person signed in, as the rail's foot and the phone bar's account place show them. */
export type Account = {
  /** The person's name; an administrator's grant stores none, so the row names the address instead. */
  name?: string;
  /** The role the area is for, the row's second line. */
  role: Copy;
  /** The sign-in address: under the name at the top of the menu, or the row's own name where there is none. */
  address: string;
};

/**
 * Ends the session and leaves the document whole, as Next's guide advises for a sign-out: a soft navigation
 * would keep every hidden route with its rows and typed text. A failure leaves the person where they are.
 */
async function abmelden() {
  const result = await signOut().catch(() => null);
  if (result?.success === true) {
    leaveDocumentFor("/");
    return;
  }
  appToast("danger", COPY.shared.toast.fehler);
}

/** The themes as next-themes names them, each by its glyph, in the order the owner set: dark, light, system. */
const THEMES: readonly GlyphChoice[] = [
  { id: "dark", glyph: "dunkel", label: COPY.vorlage.darstellung.dunkel },
  { id: "light", glyph: "hell", label: COPY.vorlage.darstellung.hell },
  { id: "system", glyph: "system", label: COPY.vorlage.darstellung.system },
];

/**
 * The account menu, the same in every area: Konto and Abmelden; Impressum and Datenschutz; and at its foot the
 * theme as one row, „Darstellung“ with the three glyphs. A person with a name sees it with their address at
 * the top; an address alone already stands in the row, so the menu does not repeat it.
 */
function AccountMenu({ account, trigger }: { account: Account; trigger: ReactElement }) {
  // The theme next-themes holds; the menu's content renders only once it is opened, after hydration.
  const { theme, setTheme } = useTheme();
  return (
    <Menu
      label={COPY.vorlage.konto}
      placement="above"
      head={account.name === undefined ? undefined : { name: account.name, detail: account.address }}
      groups={[
        [
          { kind: "link", label: COPY.vorlage.konto, href: ROUTES.kontoAnmeldung.pfad() },
          { kind: "action", label: COPY.shared.verb.abmelden, onAction: () => void abmelden() },
        ],
        [
          { kind: "link", label: ROUTES.impressum.titel, href: ROUTES.impressum.pfad() },
          { kind: "link", label: ROUTES.datenschutz.titel, href: ROUTES.datenschutz.pfad() },
        ],
      ]}
      foot={{
        label: COPY.seite.darstellung,
        control: (
          <Segmented
            placement="inline"
            label={COPY.seite.darstellung}
            choices={THEMES}
            value={theme ?? null}
            onChange={setTheme}
          />
        ),
      }}
      trigger={trigger}
    />
  );
}

/**
 * The entry the address belongs to: the longest one the path equals or lies under, so an area's Übersicht
 * is not marked on a page beneath it that has an entry of its own.
 */
function currentOf<Href extends string>(path: string, hrefs: ReadonlyArray<Href>) {
  return hrefs
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .reduce<Href | null>((best, href) => (best === null || href.length > best.length ? href : best), null);
}

function useCurrent(entries: ReadonlyArray<{ href: Route }>) {
  return currentOf(
    usePathname(),
    entries.map((entry) => entry.href),
  );
}

/**
 * Its children afresh on every page: a sheet the layout keeps would otherwise stay open after one of its links
 * led on, since a layout outlives the page it surrounds.
 */
function FreshPerPage({ children }: { children: ReactNode }) {
  return <Fragment key={usePathname()}>{children}</Fragment>;
}

// The current entry is marked as every navigating list marks its place, the link carrying `data-selected`.
// Collapsed, the entry clips its words past its glyph's box (`railGlyph`).
const railEntry = tv({
  base: "flex h-[2.125rem] items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state)",
  variants: {
    current: {
      true: entryMark({ mark: "place" }),
      false: "text-fg-muted hover:bg-bg-muted hover:text-fg",
    },
  },
});

// A group's heading fades as the rail collapses and its 24-px line folds away, so the entries below slide
// up with the width rather than jump, as shadcn/ui's sidebar folds its group labels.
const railHeading = groupHeading({
  class:
    "mb-1 overflow-hidden px-3 py-1 whitespace-nowrap transition-[margin,opacity] duration-(--motion-in) group-data-collapsed:-mt-6 group-data-collapsed:mb-0 group-data-collapsed:opacity-0",
});

/** The rail's entries in their groups, the current one in the brand colour on the muted fill. */
export function RailEntries({ groups: given }: { groups: ReadonlyArray<RailGroup> }) {
  const groups = useEntries(given);
  const current = useCurrent(groups.flatMap((group) => group.entries));
  return (
    // One column no wider than the rail: an implicit column grows to its group's unbreakable content, and a
    // heading or an entry's words, each kept on one line, outgrow the collapsed rail, which would carry every
    // entry's fill to the rail's edge and past it.
    <nav
      aria-label={COPY.vorlage.navigation}
      className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto px-3 py-2">
      {groups.map((group, index) => (
        <div key={group.heading ?? index}>
          {group.heading !== undefined && <h2 className={railHeading}>{group.heading}</h2>}
          <div className="grid gap-1">
            {group.entries.map((entry) => (
              <RailTooltip
                key={entry.id}
                label={entry.label}>
                <NextLink
                  href={entry.href}
                  aria-current={entry.href === current ? "page" : undefined}
                  data-selected={entry.href === current || undefined}
                  data-kit-focus="inset"
                  className={railEntry({ current: entry.href === current })}>
                  <span className={railGlyph()}>
                    <Icon
                      glyph={entry.icon}
                      size={18}
                    />
                  </span>
                  <span className={railFade()}>{entry.label}</span>
                </NextLink>
              </RailTooltip>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** A person's initials, for the round avatar standing in for them. */
function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return `${words[0]?.charAt(0) ?? ""}${words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : ""}`.toUpperCase();
}

const avatar = tv({
  base: "flex shrink-0 items-center justify-center rounded-full bg-bg-muted font-semibold text-fg",
  variants: {
    size: {
      rail: "size-8 text-xs",
      bar: "size-6 text-xs",
    },
  },
});

/**
 * The person signed in, read for the frame and handed down unawaited, so the frame streams before the session
 * is judged; `null` for a session the area turns away, whose page sends it on.
 */
export type AccountRead = Promise<Account | null>;

/**
 * The rail's foot when signed in: the name, the role under it, and „…“; the whole row opens the account menu.
 * Collapsed, the avatar alone stands centred, 8 px of the row's inset after the foot's 12, and the words
 * fade, clipped by the row.
 */
export function AccountRow({ account: read }: { account: AccountRead }) {
  const account = use(read);
  if (account === null) return null;
  const name = account.name ?? account.address;
  return (
    <AccountMenu
      account={account}
      trigger={
        <AriaButton
          data-kit-focus="ring"
          className="flex h-12 w-full items-center gap-3 overflow-hidden rounded-lg px-2 text-start text-sm transition-colors duration-(--motion-state) data-hovered:bg-bg-muted">
          <span
            aria-hidden
            className={avatar({ size: "rail" })}>
            {initials(name)}
          </span>
          <span className={railFade({ class: "grid min-w-0 flex-1" })}>
            <span className="truncate font-semibold text-fg">{name}</span>
            <span className="truncate text-xs text-fg-muted">{account.role}</span>
          </span>
          <span className={railFade({ class: "text-fg-muted" })}>
            <Icon
              glyph="mehr"
              size={16}
            />
          </span>
        </AriaButton>
      }
    />
  );
}

const barPlace = tv({
  base: "flex h-full min-w-0 flex-col items-center justify-center gap-1 text-xs font-medium",
  variants: {
    current: {
      true: "text-brand",
      false: "text-fg-muted",
    },
  },
});

/** The frame's menu as the phone's band and bar draw it, which a nested layout placing them cannot be handed. */
export type FrameMenu = {
  groups: ReadonlyArray<RailGroup>;
  bar: ReadonlyArray<string>;
  /** Links the rail keeps in its foot or the strip, which the phone reaches through „Mehr“. */
  extra: ReadonlyArray<{ label: Copy; href: Route }>;
  account?: AccountRead;
};

const MenuContext = createContext<FrameMenu | null>(null);

/** Hands the frame's menu to the band and the bar, wherever in the frame's layouts they are placed. */
export function MenuScope({ value, children }: { value: FrameMenu; children: ReactNode }) {
  return <MenuContext value={value}>{children}</MenuContext>;
}

/**
 * The phone's bottom bar: its pages, „Mehr“ where the menu holds more, and the account as a place of its
 * own. „Mehr“ opens the rest of the menu as a sheet, grouped as the rail is, with the frame's extra links.
 */
export function BarPlaces() {
  const menu = useContext(MenuContext);
  return menu === null ? null : <Places {...menu} />;
}

function Places({ groups: given, bar, extra, account }: FrameMenu) {
  const groups = useEntries(given);
  const entries = groups.flatMap((group) => group.entries);
  const current = useCurrent(entries);
  const placed = bar.flatMap((id) => entries.filter((entry) => entry.id === id));
  const rest = groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => !bar.includes(entry.id)) }))
    .filter((group) => group.entries.length > 0);

  return (
    <nav
      aria-label={COPY.vorlage.navigation}
      className="sticky bottom-0 z-20 grid h-14 auto-cols-fr grid-flow-col border-t border-border bg-bg lg:hidden">
      {placed.map((entry) => (
        <NextLink
          key={entry.id}
          href={entry.href}
          aria-current={entry.href === current ? "page" : undefined}
          data-kit-focus="inset"
          className={barPlace({ current: entry.href === current })}>
          <Icon
            glyph={entry.icon}
            size={18}
          />
          <span className="max-w-full truncate px-1">{entry.label}</span>
        </NextLink>
      ))}
      {(rest.length > 0 || extra.length > 0) && (
        <FreshPerPage>
          <Sheet
            label={COPY.vorlage.mehr}
            trigger={
              <AriaButton
                data-kit-focus="inset"
                className={barPlace({ current: false })}>
                <Icon
                  glyph="mehr"
                  size={18}
                />
                {COPY.vorlage.mehr}
              </AriaButton>
            }>
            <div className="grid gap-4 pt-2">
              {rest.map((group, index) => (
                <div
                  key={group.heading ?? index}
                  className="grid gap-1">
                  {group.heading !== undefined && <h2 className={groupHeading({ class: "px-3 py-1" })}>{group.heading}</h2>}
                  {group.entries.map((entry) => (
                    <NextLink
                      key={entry.id}
                      href={entry.href}
                      aria-current={entry.href === current ? "page" : undefined}
                      data-kit-focus="inset"
                      className={menuEntry({ size: "phone" })}>
                      <Icon
                        glyph={entry.icon}
                        size={18}
                      />
                      {entry.label}
                    </NextLink>
                  ))}
                </div>
              ))}
              {extra.length > 0 && (
                <div className="grid gap-1 border-t border-border pt-2">
                  {extra.map((link) => (
                    <NextLink
                      key={link.href}
                      href={link.href}
                      data-kit-focus="inset"
                      className={menuEntry({ size: "phone" })}>
                      {link.label}
                    </NextLink>
                  ))}
                </div>
              )}
            </div>
          </Sheet>
        </FreshPerPage>
      )}
      {account !== undefined && (
        // The bar's places stand drawn while the session is judged; the account's keeps its column.
        <Suspense fallback={<span />}>
          <AccountPlace account={account} />
        </Suspense>
      )}
    </nav>
  );
}

/** The phone bar's account place: the avatar over „Konto“, opening the account menu. */
function AccountPlace({ account: read }: { account: AccountRead }) {
  const account = use(read);
  if (account === null) return null;
  return (
    <AccountMenu
      account={account}
      trigger={
        <AriaButton
          data-kit-focus="inset"
          className={barPlace({ current: false })}>
          <span
            aria-hidden
            className={avatar({ size: "bar" })}>
            {initials(account.name ?? account.address)}
          </span>
          {COPY.vorlage.konto}
        </AriaButton>
      }
    />
  );
}

// On the dark-green band, as tall as a touch target; the chevron stands where the logo's edge would.
const back = tv({ base: "-ms-2 flex h-11 items-center gap-1 rounded-lg ps-1 pe-3 text-sm font-medium text-on-brand" });

/**
 * „‹ Zurück“ in the band where the logo stands: in Konto, and on a phone in an editor. While an editor holds
 * unsaved changes it asks first, and going back drops them.
 */
export function BackControl({ href }: { href: Route }) {
  const guard = useLeaveGuard();
  const router = useRouter();
  const content = (
    <>
      <Icon
        glyph="zurueck"
        size={18}
      />
      {COPY.shared.zurueck}
    </>
  );

  if (guard === null) {
    return (
      <NextLink
        href={href}
        data-kit-focus="ring"
        className={back()}>
        {content}
      </NextLink>
    );
  }
  return (
    <ConfirmDialog
      verb="verwerfen"
      subject={COPY.vorlage.aenderungen}
      consequence={COPY.vorlage.aenderungenVerloren(guard.count)}
      tone="danger"
      onConfirm={() => {
        guard.discard();
        router.push(href);
      }}
      trigger={
        <AriaButton
          data-kit-focus="ring"
          className={back()}>
          {content}
        </AriaButton>
      }
    />
  );
}

/**
 * „‹ Zurück“ in an editor's band, to the list the rail marks for the editor's address: a record's page lies
 * under its list, so the way back is read from the address rather than declared by each editor.
 */
export function EditorBack() {
  const groups = useEntries(useContext(MenuContext)?.groups ?? []);
  const href = useCurrent(groups.flatMap((group) => group.entries));
  return href === null ? null : <BackControl href={href} />;
}

/** A link of the classic header: catalogue words and an address the layout gives. */
export type HeaderLink = { label: Copy; href: Route };

/**
 * The classic header's links and „Anmelden“ on the band: in a row from 1024 px, and on a phone behind one
 * button opening them as a sheet.
 */
export function HeaderLinks({ links, anmelden }: { links: ReadonlyArray<HeaderLink>; anmelden: Route }) {
  const current = currentOf(
    usePathname(),
    links.map((link) => link.href),
  );
  return (
    <>
      <nav
        aria-label={COPY.vorlage.navigation}
        className="hidden gap-2 lg:flex">
        {links.map((link) => (
          <NextLink
            key={link.href}
            href={link.href}
            aria-current={link.href === current ? "page" : undefined}
            data-kit-focus="ring"
            className={frameLink({ tone: link.href === current ? "band" : "bandMuted" })}>
            {link.label}
          </NextLink>
        ))}
      </nav>
      <NextLink
        href={anmelden}
        data-kit-focus="ring"
        className={frameLink({ tone: "band", class: "ms-auto hidden lg:flex" })}>
        {COPY.shared.verb.anmelden}
      </NextLink>
      <div className="ms-auto lg:hidden">
        <FreshPerPage>
          <Sheet
            label={COPY.vorlage.menue}
            trigger={
              <AriaButton
                aria-label={COPY.vorlage.menue}
                data-kit-focus="ring"
                className="flex size-11 items-center justify-center rounded-lg text-on-brand">
                <Icon
                  glyph="menue"
                  size={18}
                />
              </AriaButton>
            }>
            <div className="grid gap-1 pt-2">
              {[...links, { label: COPY.shared.verb.anmelden, href: anmelden }].map((link) => (
                <NextLink
                  key={link.href}
                  href={link.href}
                  aria-current={link.href === current ? "page" : undefined}
                  data-kit-focus="inset"
                  className={menuEntry({ size: "phone" })}>
                  {link.label}
                </NextLink>
              ))}
            </div>
          </Sheet>
        </FreshPerPage>
      </div>
    </>
  );
}

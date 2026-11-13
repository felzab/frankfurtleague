"use client";

import { createContext, use, useContext, useEffect, useState } from "react";
import NextLink from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";

import { useTheme } from "next-themes";
import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";
import { ROLE_ROOTS, ROUTES } from "@/core/routes";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";
import { signOut } from "@/shared/utils/signOut";

import { ConfirmDialog } from "./ConfirmDialog";
import { CutText } from "./CutText";
import { entryMark } from "./fieldStyles";
import { GlyphChoices, GlyphChoicesPlaceholder } from "./GlyphChoices";
import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { useLeaveGuard } from "./LeaveGuard";
import { menuEntry } from "./Link";
import { Menu } from "./Menu";
import { currentOf, FreshPerPage, placeOf } from "./navPlace";
import { RailTooltip, useRailCollapsed } from "./RailState";
import { groupHeading, railFade, railGlyph } from "./railStyles";
import { Sheet } from "./Sheet";
import { Placeholder, placeholderBar, PlaceholderLine } from "./Skeleton";
import { appToast } from "./Toast";
import { tv } from "./tv";
import { PageWait } from "./WholePage";

import type { Copy, RecordText } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { GlyphChoice } from "./GlyphChoices";
import type { IconName } from "./Icon";
import type { MenuEntry, MenuLink } from "./Menu";

/** A page every season holds once, by its route in the table: a route whose address takes the season alone. */
type SaisonPage = {
  [K in keyof typeof ROUTES]: Parameters<(typeof ROUTES)[K]["path"]> extends [string] ? K : never;
}[keyof typeof ROUTES];

/**
 * A page a team holds once in each of its seasons, by its route in the table: a route whose address takes the team
 * and then the season, and is the team's Übersicht or lies under it. The address is part of the test: a season's page
 * of one record, such as a club's public page, takes two segments as well, the season first.
 */
type TeamPage = {
  [K in keyof typeof ROUTES]: Parameters<(typeof ROUTES)[K]["path"]> extends [string, string]
    ? ReturnType<(typeof ROUTES)[K]["path"]> extends ReturnType<typeof ROUTES.teamOverview.path>
      ? K
      : never
    : never;
}[keyof typeof ROUTES];

/**
 * One page a frame's menu leads to: its name, its glyph in the rail and in the phone bar, and its address, or
 * the season's page it is, whose address the frame fills in with the season the page works in, or the page of a
 * team's season it is, whose address the frame fills in with that season and the team the address names.
 */
type RailEntry = { id: string; label: Copy; icon: IconName } & (
  | { href: Route; saison?: never; team?: never }
  | { saison: SaisonPage; href?: never; team?: never }
  | { team: TeamPage; href?: never; saison?: never }
);

/** Entries the rail sets together under one heading; the first group of an area may stand without one. */
export type RailGroup = { heading?: Copy; entries: ReadonlyArray<RailEntry> };

/** The seasons a person may switch between, the newest first, and the one a page whose address names none works in. */
export type Saisons = {
  /** Each season's id, and its span as `formatPeriod` writes it on the server, which the rail's button shows under the name. */
  entries: ReadonlyArray<{ id: string; span: string }>;
  standard: string;
};

/**
 * A frame's seasons, read for the frame and handed down unawaited, so the frame streams before the read
 * settles; `null` where the person has no season yet.
 */
type SaisonFrame = {
  saisons: Promise<Saisons | null>;
  /** The season's first page, where a switch from a page with no counterpart in the other season lands. */
  home: SaisonPage;
  /** Where a season's page is reached while there is no season at all. */
  withoutSaison?: Route;
  teams?: never;
};

/**
 * A team frame's seasons, handed down unawaited as a season frame's are: every team the person holds, by its id as the
 * address spells it, each with the seasons the person holds it in. The layout reads the person and the address alone
 * names the team, so the frame takes the seasons of the team the address names; at the address of a team the person
 * does not hold it has no season to offer, and lists the team's pages at the team and season the address spells.
 */
type TeamFrame = {
  teams: Promise<ReadonlyArray<Saisons & { team: string }>>;
  /** The team's first page in a season, where a switch from a page with no counterpart in the other season lands. */
  home: TeamPage;
  saisons?: never;
  withoutSaison?: never;
};

/** The seasons a frame's season button offers and its season pages take: the person's own, or those of each team they hold. */
export type FrameSaisons = SaisonFrame | TeamFrame;

/** A frame's seasons with the season pages its menu lists. */
type SaisonScopeValue = (SaisonFrame & { pages: readonly SaisonPage[] }) | (TeamFrame & { pages: readonly TeamPage[] });

/** A frame's seasons, with the season the last address naming one named, which a page whose address names none works in. */
const SaisonContext = createContext<(SaisonScopeValue & { chosen?: string }) | null>(null);

/**
 * Hands the frame's seasons and its season pages to its menus, which a layout's server code cannot reach, and holds the
 * last season an address named for as long as the frame's layout stays mounted: React state alone, so a reload or a new
 * sign-in starts at the standard season, and nothing is stored.
 */
export function SaisonScope({ value, children }: { value: SaisonScopeValue; children: ReactNode }) {
  const [chosen, setChosen] = useState<string>();
  return (
    <SaisonContext value={{ ...value, chosen }}>
      {/* Reads the address, which no prerender knows, so it waits in a boundary of its own, drawing nothing. */}
      <PageWait fallback={null}>
        <SaisonMemory choose={setChosen} />
      </PageWait>
      {children}
    </SaisonContext>
  );
}

/**
 * Records the season the address names once the page showing it is committed. The record is read only on a page whose
 * address names none, so the render after it changes nothing a person sees.
 */
function SaisonMemory({ choose }: { choose: (saison: string) => void }) {
  const { saison } = useParams();
  useEffect(() => {
    if (typeof saison === "string") choose(saison);
  }, [saison, choose]);
  return null;
}

/** Whether the frame holds seasons at all, which it knows before they are read: a frame with none draws no season button. */
export function useHoldsSaison() {
  return useContext(SaisonContext) !== null;
}

type Params = ReturnType<typeof useParams>;

/** A season page's address in a season, the team the address names filled in where the page is a team's. */
type SaisonAddress = (saison: string) => Route;

/** The season a page works in, with the seasons to switch between and the frame's season pages by their addresses. */
type FrameSaison = {
  entries: Saisons["entries"];
  active: string;
  /** The team the address names, in a team's frame. */
  team?: string;
  home: SaisonAddress;
  pages: ReadonlyArray<SaisonAddress>;
};

/** The frame's root, the address naming no season where its first page stands in the standard season (`ROLE_ROOTS`). */
function rootOf(frame: SaisonScopeValue | null): Route | undefined {
  return frame === null || frame.teams !== undefined ? undefined : ROLE_ROOTS[frame.home];
}

/**
 * The season the page works in: the one its address names where the frame holds it; at the frame's root, which draws
 * the standard season's page, the standard; on another page whose address names none, the one the last address naming
 * one named where the frame holds it; else the frame's standard. In a team's frame among the seasons of the team the
 * address names; `null` where there is none.
 */
export function useFrameSaison(): FrameSaison | null {
  return useWorkingSaison(false) ?? null;
}

/**
 * `useFrameSaison`, or, where `listless` and the address names the season, and in a team's frame the team too,
 * `undefined` without waiting for the seasons' read: the address spells every page's address in that season.
 */
function useWorkingSaison(listless: boolean): FrameSaison | null | undefined {
  const frame = useContext(SaisonContext);
  const { saison, team } = useParams();
  const path = usePathname();
  if (frame === null) return null;
  if (listless && typeof saison === "string" && (frame.teams === undefined || typeof team === "string")) return undefined;
  // The season chosen before is sought only where the address names none and the page is no root: an address naming a
  // season the frame does not hold, as a not-found page's, falls to the standard, as it would on the first page the
  // frame shows, and so does a root, whose page is the standard season's.
  const sought = typeof saison === "string" ? saison : path === rootOf(frame) ? undefined : frame.chosen;
  const activeIn = (held: Saisons) => held.entries.find((entry) => entry.id === sought)?.id ?? held.standard;

  if (frame.teams !== undefined) {
    const held = use(frame.teams).find((each) => each.team === team);
    if (held === undefined) return null;
    return {
      entries: held.entries,
      active: activeIn(held),
      team: held.team,
      home: (to) => ROUTES[frame.home].path(held.team, to),
      pages: frame.pages.map((page) => (to) => ROUTES[page].path(held.team, to)),
    };
  }

  const saisons = use(frame.saisons);
  if (saisons === null) return null;
  return {
    entries: saisons.entries,
    active: activeIn(saisons),
    home: (to) => ROUTES[frame.home].path(to),
    pages: frame.pages.map((page) => (to) => ROUTES[page].path(to)),
  };
}

/**
 * The same page in season `to`: the address with its season swapped, so a team's page stays its team's. A record's
 * page, an address naming a record past the season, has no counterpart there and lands on the list it lies under,
 * the season page the rail marks for it; a page whose address names no season lands on the season's first page.
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
  home: SaisonAddress;
  pages: ReadonlyArray<SaisonAddress>;
}): Route {
  const from = params.saison;
  const segments = path.split("/");
  const at = typeof from === "string" ? segments.indexOf(from) : -1;
  if (typeof from !== "string" || at === -1) return home(to);

  const records = Object.entries(params).flatMap(([name, value]) => (name === "saison" || value === undefined ? [] : [value].flat()));
  if (segments.slice(at + 1).some((segment) => records.includes(segment))) {
    const lists = pages.map((page) => ({ page, href: page(from) }));
    const list = lists.find(
      (each) =>
        each.href ===
        currentOf(
          path,
          lists.map((one) => one.href),
        ),
    );
    return (list?.page ?? home)(to);
  }

  segments[at] = to;
  return segments.join("/");
}

/**
 * The entries with their addresses, a season's page in the season the page works in and a team's with the team the
 * address names; one with no address is left out. With no season at all a season's page leads to `withoutSaison`,
 * which is its own address (`own`) only where no other entry leads there: a frame of one season page has its place
 * there, and several led to one address are the place of none. A team the person does not hold keeps its pages in the
 * menu, each at the team and season the address spells and each answering with the same refusal, so the menu there is
 * the one every team's address shows.
 *
 * `listless`, the entries wait for no read where the address names the season, and a team's the team: each takes them
 * as the address spells them, which `RailEntries` and `BarPlaces` stand until the read confirms or corrects them.
 */
function useEntries(groups: ReadonlyArray<RailGroup>, listless = false) {
  const frame = useContext(SaisonContext);
  // `undefined` where the address spells what the entries need and they were asked not to wait.
  const saison = useWorkingSaison(listless);
  const { team, saison: named } = useParams();
  const hrefOf = (entry: RailEntry): Route | undefined => {
    if (entry.href !== undefined) return entry.href;
    if (entry.team !== undefined) {
      if (saison?.team !== undefined) return ROUTES[entry.team].path(saison.team, saison.active);
      const spelled = frame?.teams !== undefined && typeof team === "string" && typeof named === "string";
      return spelled ? ROUTES[entry.team].path(team, named) : undefined;
    }
    if (saison === undefined) return typeof named === "string" ? ROUTES[entry.saison].path(named) : undefined;
    return saison === null ? frame?.withoutSaison : ROUTES[entry.saison].path(saison.active);
  };
  const led = groups.flatMap((group) => group.entries.map(hrefOf));
  return groups
    .map((group) => ({
      heading: group.heading,
      entries: group.entries.flatMap((entry) => {
        const href = hrefOf(entry);
        if (href === undefined) return [];
        const own = entry.saison === undefined || saison !== null || led.filter((each) => each === href).length === 1;
        const home = entry.saison !== undefined && entry.saison === frame?.home;
        return [{ id: entry.id, label: entry.label, icon: entry.icon, href, own, home }];
      }),
    }))
    .filter((group) => group.entries.length > 0);
}

/** The person signed in, as the rail's foot and the phone bar's account place show them. */
export type Account = {
  /** The person's name; an administrator's grant stores none, so the row names the address instead. */
  name?: RecordText;
  /**
   * The role the area is for, the row's second line on a page whose place gives none of its own. An area that is no
   * one role's gives none, and the row there is the name alone.
   */
  role?: Copy;
  /** The sign-in address: whole at the top of the menu, under the name where there is one; the row's own name where not. */
  address: RecordText;
  /**
   * Every Funktion the person holds, by the page each opens on; two or more open „Funktion wechseln“, one being no
   * choice to offer. The menu marks the one the page lies under, so a reader of the person marks none. A place's own
   * `role` is the row's second line on every page under it, as a team's short code and the seats held there: the
   * area's line cannot name the team, which the address alone knows.
   */
  roles?: ReadonlyArray<Omit<MenuLink, "isCurrent"> & { role?: Copy }>;
};

/**
 * The place of the person's the page at `path` lies under, read from the address: a team's layout stands above the
 * team and the season of its address, so it names neither.
 */
function placeAt(account: Account, path: string) {
  const places = account.roles ?? [];
  const href = currentOf(
    path,
    places.map((place) => place.href),
  );
  return places.find((place) => place.href === href);
}

/**
 * Ends the session and leaves the document whole, as Next's guide advises for a sign-out: a soft navigation
 * would keep every hidden route with its rows and typed text. A failure leaves the person where they are.
 */
async function signOutAndLeave() {
  if (await signOut().catch(() => false)) {
    leaveDocumentFor("/");
    return;
  }
  appToast("danger", COPY.shared.toast.failure);
}

/** The themes as next-themes names them, each by its glyph, in the order the owner set: dark, light, system. */
const THEMES: readonly GlyphChoice[] = [
  { id: "dark", glyph: "dark", label: COPY.template.theme.dark },
  { id: "light", glyph: "light", label: COPY.template.theme.light },
  { id: "system", glyph: "system", label: COPY.template.theme.system },
];

/**
 * The theme as the account menu's foot and Konto's Darstellung set it, one control in both places: the three
 * glyphs, each named by its tooltip, acting at once.
 */
export function ThemeChoice() {
  // The theme next-themes holds, unknown until the page hydrates, so none is chosen before.
  const { theme, setTheme } = useTheme();
  return (
    <GlyphChoices
      label={COPY.page.accountAppearance}
      choices={THEMES}
      value={theme ?? null}
      onChange={setTheme}
    />
  );
}

/** The theme's control while its box waits: one glyph's bar per theme. */
export function ThemeChoicePlaceholder() {
  return <GlyphChoicesPlaceholder count={THEMES.length} />;
}

/**
 * The account menu, the same in every area: „Funktion wechseln“ in a group of its own for a person holding two or
 * more Funktionen, its submenu marking the one the page lies under; Konto and Abmelden; Impressum and Datenschutz; and at
 * its foot the theme as one row, „Darstellung“ with the three glyphs. It heads with the person's whole address, under
 * their name where one is stored, for every role alike: the row is one line, which cuts a long address, so the menu is
 * where it is read in full. `accountPage` is the Konto page the menu opens: the phone's list of its pages, or on desktop
 * its first page, beside the rail listing the rest.
 */
function AccountMenu({
  account,
  accountPage,
  trigger,
  beside,
}: {
  account: Account;
  accountPage: Route;
  trigger: ReactElement;
  beside?: boolean;
}) {
  const here = placeAt(account, usePathname());
  const roles = (account.roles ?? []).map((place) => ({ ...place, isCurrent: place.href === here?.href }));
  const switchRole: ReadonlyArray<ReadonlyArray<MenuEntry>> =
    roles.length < 2 ? [] : [[{ kind: "submenu", label: COPY.shared.switchRole, links: roles }]];
  return (
    <Menu
      label={COPY.template.account}
      placement="above"
      beside={beside}
      head={{ name: account.name, detail: account.address }}
      groups={[
        ...switchRole,
        [
          { kind: "link", label: COPY.template.account, href: accountPage },
          { kind: "action", label: COPY.shared.verb.signOut, onAction: () => void signOutAndLeave() },
        ],
        [
          { kind: "link", label: ROUTES.legalNotice.title, href: ROUTES.legalNotice.path() },
          { kind: "link", label: ROUTES.privacyNotice.title, href: ROUTES.privacyNotice.path() },
        ],
      ]}
      foot={{ label: COPY.page.accountAppearance, control: <ThemeChoice /> }}
      trigger={trigger}
    />
  );
}

/**
 * The entry the address belongs to: only by an address of its own, since a page several entries lead to is the place of
 * none of them; at the frame's root, the first page's, which the root draws, its entry leading to the season's address.
 */
function useCurrent<Entry extends { href: Route; own: boolean; home: boolean }>(entries: ReadonlyArray<Entry>) {
  const { saison } = useParams();
  const path = usePathname();
  const root = rootOf(useContext(SaisonContext));
  const own = entries.filter((entry) => entry.own);
  if (path === root) return own.find((entry) => entry.home);
  const href = placeOf(
    path,
    typeof saison === "string" ? saison : undefined,
    own.map((entry) => entry.href),
  );
  return own.find((entry) => entry.href === href);
}

// The current entry carries the rail's own mark of the page it is on (`entryMark`'s `place`), the link carrying
// `data-selected`; a menu's chosen entry is marked otherwise, by its check.
// Collapsed, the entry clips its words past its glyph's box (`railGlyph`).
const railEntry = tv({
  base: `flex h-8 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) pointer-coarse:h-10 ${hoverLook({ host: "link" })}`,
  variants: {
    current: {
      true: entryMark({ mark: "place" }),
      false: `text-fg-muted ${hoverLook({ host: "link", answer: "words" })}`,
    },
  },
});

// A group's heading fades as the rail collapses and its 24-px line folds away, so the entries below slide
// up with the width rather than jump, as shadcn/ui's sidebar folds its group labels.
const railHeading = groupHeading({
  class:
    "mb-1 overflow-hidden px-3 py-1 whitespace-nowrap transition-[margin,opacity] duration-(--motion-in) group-data-collapsed:-mt-6 group-data-collapsed:mb-0 group-data-collapsed:opacity-0",
});

// Where a heading folds away, a hairline as wide as a glyph fades in, centred in the 16-px gap above its
// group, so the collapsed rail still reads in groups, as Linear's and Vercel's collapsed
// sidebars do; none above the first group, which nothing precedes.
const railRule = tv({
  base: "pointer-events-none absolute inset-x-0 -top-2 mx-auto h-px w-4.5 bg-border opacity-0 transition-opacity duration-(--motion-in) group-data-collapsed:opacity-100",
});

/**
 * The rail's entries in their groups, the current one in the brand colour on the muted fill. Where the address names
 * the season they stand at once as it spells them, and the seasons' read, landing, keeps them or, for a season the
 * frame does not hold, leads them to its standard: the not-found page stands in the frame, and a menu following an
 * unknown season would lead every entry to another not-found page.
 */
export function RailEntries(props: { groups: ReadonlyArray<RailGroup>; prefetch?: true }) {
  return (
    <PageWait
      fallback={
        <RailEntryList
          {...props}
          listless
        />
      }>
      <RailEntryList {...props} />
    </PageWait>
  );
}

function RailEntryList({ groups: given, prefetch, listless }: { groups: ReadonlyArray<RailGroup>; prefetch?: true; listless?: true }) {
  const groups = useEntries(given, listless);
  const current = useCurrent(groups.flatMap((group) => group.entries));
  return (
    // One column no wider than the rail: an implicit column grows to its group's unbreakable content, and a
    // heading or an entry's words, each kept on one line, outgrow the collapsed rail, which would carry every
    // entry's fill to the rail's edge and past it.
    <nav
      aria-label={COPY.template.navigation}
      className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto px-3 py-2">
      {groups.map((group, index) => (
        <div
          key={group.heading ?? index}
          className="relative">
          {group.heading !== undefined && index > 0 && (
            <span
              aria-hidden
              className={railRule()}
            />
          )}
          {group.heading !== undefined && <h2 className={railHeading}>{group.heading}</h2>}
          <div className="grid gap-1">
            {group.entries.map((entry) => (
              <RailTooltip
                key={entry.id}
                label={entry.label}>
                <NextLink
                  href={entry.href}
                  prefetch={prefetch}
                  aria-current={entry === current ? "page" : undefined}
                  data-selected={entry === current || undefined}
                  data-kit-focus="inset"
                  className={railEntry({ current: entry === current })}>
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

/**
 * The rail's entries while their addresses wait, in a prerendered shell for the address, on a page naming no season for
 * the seasons' read: every group and entry as `RailEntries` draws it, each heading's and name's words a bar as wide as
 * they will stand and each glyph a bar of its size, so the entries appear in their places. No entry is marked current,
 * which the address decides once the wait ends.
 */
export function RailEntriesPlaceholder({ groups }: { groups: ReadonlyArray<RailGroup> }) {
  return (
    <Placeholder layoutClass="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-hidden px-3 py-2">
      {groups.map((group, index) => (
        <div
          key={group.heading ?? index}
          className="relative">
          {group.heading !== undefined && (
            <div className={railHeading}>
              <PlaceholderLine
                textClass="text-xs"
                words={group.heading}
              />
            </div>
          )}
          <div className="grid gap-1">
            {group.entries.map((entry) => (
              <span
                key={entry.id}
                className={railEntry({ current: false })}>
                <span className={railGlyph()}>
                  <span className={placeholderBar("size-4.5")} />
                </span>
                <span className={railFade()}>
                  <PlaceholderLine
                    textClass="text-sm"
                    words={entry.label}
                  />
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </Placeholder>
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
 * The rail's foot when signed in: the avatar, the name and the role under it, the role of the place the page lies
 * under where that place gives its own, else the area's, and the name alone where neither gives one. The whole row is
 * the one button opening the account menu, filled under the pointer as the season button over it is, so it carries no
 * „…“ of its own, which would read as a second, smaller target, and the name keeps that room. Collapsed, the avatar
 * alone stands centred, 8 px of the row's inset after the foot's 12, and the words fade, clipped by the row; the menu
 * then opens beside the row, at the rail's edge.
 */
export function AccountRow({ account: read }: { account: AccountRead }) {
  const collapsed = useRailCollapsed();
  const path = usePathname();
  const account = use(read);
  if (account === null) return null;
  const { record: name } = account.name ?? account.address;
  const role = placeAt(account, path)?.role ?? account.role;
  return (
    <AccountMenu
      account={account}
      accountPage={ROUTES.accountSignIn.path()}
      beside={collapsed}
      trigger={
        <AriaButton
          data-kit-focus="ring"
          className={`flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-lg px-2 py-1 text-start text-sm ${hoverLook({ host: "aria" })}`}>
          <span
            aria-hidden
            className={avatar({ size: "rail" })}>
            {initials(name)}
          </span>
          <span className={railFade({ class: "grid min-w-0 flex-1" })}>
            {/* One line, an address standing as the name too, cut with „…“ and whole on hover, so the foot stands as
                tall as the editor's bar beside it (`editorBarLook`); Konto shows the whole address. */}
            <CutText
              text={name}
              className="truncate font-semibold text-fg"
            />
            {role !== undefined && <span className="truncate text-xs text-fg-muted">{role}</span>}
          </span>
        </AriaButton>
      }
    />
  );
}

/**
 * The rail's foot while the session is judged: the row `AccountRow` draws, its avatar and its two lines as bars of
 * their sizes, so the foot keeps its height and the entries above stay where they are.
 */
export function AccountRowPlaceholder() {
  return (
    <Placeholder layoutClass="flex h-12 w-full items-center gap-3 overflow-hidden rounded-lg px-2">
      <span className={placeholderBar(avatar({ size: "rail" }))} />
      <span className={railFade({ class: "grid min-w-0 flex-1" })}>
        <PlaceholderLine
          textClass="text-sm"
          widthClass="w-3/4"
        />
        <PlaceholderLine
          textClass="text-xs"
          widthClass="w-1/2"
        />
      </span>
    </Placeholder>
  );
}

// A place's placeholder names no `host`: it borrows the box and answers nothing. The current place keeps its green
// under the pointer, and every other turns its words full colour.
const barPlace = tv({
  base: "flex h-full min-w-0 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-(--motion-state)",
  variants: {
    current: {
      true: "text-brand",
      false: "text-fg-muted",
    },
    host: {
      link: hoverLook({ host: "link" }),
      aria: hoverLook({ host: "aria" }),
    },
  },
  compoundVariants: [
    { host: "link", current: false, class: hoverLook({ host: "link", answer: "words" }) },
    { host: "aria", current: false, class: hoverLook({ host: "aria", answer: "words" }) },
  ],
});

/** The frame's menu as the phone's band and bar draw it, which a nested layout placing them cannot be handed. */
export type FrameMenu = {
  groups: ReadonlyArray<RailGroup>;
  bar: ReadonlyArray<string>;
  /**
   * Links the rail keeps in its foot or the strip, which the phone reaches through „Mehr“; `prefetch: false` for
   * „Konto“, whose prefetched sign-in would be drawn before the proxy sends a signed-in person on.
   */
  extra: ReadonlyArray<{ label: Copy; href: Route; prefetch?: false }>;
  account?: AccountRead;
  /** Whether the entries prefetch their pages whole (`RailFrame`'s `prefetch`); the extra links keep theirs. */
  prefetch?: true;
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
  // At once as the address spells them, as the rail's entries are (`RailEntries`).
  return menu === null ? null : (
    <PageWait
      fallback={
        <Places
          {...menu}
          listless
        />
      }>
      <Places {...menu} />
    </PageWait>
  );
}

function Places({ groups: given, bar, extra, account, prefetch, listless }: FrameMenu & { listless?: true }) {
  const groups = useEntries(given, listless);
  const entries = groups.flatMap((group) => group.entries);
  const current = useCurrent(entries);
  const placed = bar.flatMap((id) => entries.filter((entry) => entry.id === id));
  const rest = groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => !bar.includes(entry.id)) }))
    .filter((group) => group.entries.length > 0);

  return (
    // At the column's foot, by its margin, whether a page stands above it or none does yet.
    <nav
      aria-label={COPY.template.navigation}
      className="sticky bottom-0 z-20 mt-auto grid h-14 auto-cols-fr grid-flow-col border-t border-border bg-bg [view-transition-name:bar] lg:hidden">
      {placed.map((entry) => (
        <NextLink
          key={entry.id}
          href={entry.href}
          prefetch={prefetch}
          aria-current={entry === current ? "page" : undefined}
          data-kit-focus="inset"
          className={barPlace({ current: entry === current, host: "link" })}>
          <Icon
            glyph={entry.icon}
            size={18}
          />
          {/* No inset of its own: five places share a 360-px bar, and „K.-o.-Runde“ needs its column's whole width;
              the words stand centred, so the room their columns leave them parts two labels. */}
          <span className="max-w-full truncate">{entry.label}</span>
        </NextLink>
      ))}
      {(rest.length > 0 || extra.length > 0) && (
        <FreshPerPage>
          <Sheet
            label={COPY.template.more}
            trigger={
              <AriaButton
                data-kit-focus="inset"
                className={barPlace({ current: false, host: "aria" })}>
                <Icon
                  glyph="more"
                  size={18}
                />
                {COPY.template.more}
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
                      prefetch={prefetch}
                      aria-current={entry === current ? "page" : undefined}
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
                      prefetch={link.prefetch}
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
        // The bar's places stand drawn while the session is judged; the account's keeps its column, drawn as it waits.
        <PageWait
          fallback={
            <Placeholder layoutClass="h-full">
              <PlacePlaceholder
                label={COPY.template.account}
                glyph={avatar({ size: "bar" })}
              />
            </Placeholder>
          }>
          <AccountPlace account={account} />
        </PageWait>
      )}
    </nav>
  );
}

/** One of the phone bar's places while it waits: its glyph and its words as bars, over one another as the place sets them. */
function PlacePlaceholder({ label, glyph }: { label: Copy; glyph: string }) {
  return (
    <span className={barPlace({ current: false })}>
      <span className={placeholderBar(glyph)} />
      <PlaceholderLine
        textClass="text-xs"
        words={label}
      />
    </span>
  );
}

/**
 * The phone's bottom bar while its addresses wait, as the rail's entries do: every place `BarPlaces` will draw, the
 * pages, „Mehr“ and the account, each its glyph and its words as bars, so the bar stands at once at its height.
 */
export function BarPlacesPlaceholder() {
  const menu = useContext(MenuContext);
  if (menu === null) return null;
  const entries = menu.groups.flatMap((group) => group.entries);
  const placed = menu.bar.flatMap((id) => entries.filter((entry) => entry.id === id));
  const more = entries.length > placed.length || menu.extra.length > 0;
  return (
    <Placeholder layoutClass="sticky bottom-0 z-20 mt-auto grid h-14 auto-cols-fr grid-flow-col border-t border-border bg-bg lg:hidden">
      {placed.map((entry) => (
        <PlacePlaceholder
          key={entry.id}
          label={entry.label}
          glyph="size-4.5"
        />
      ))}
      {more && (
        <PlacePlaceholder
          label={COPY.template.more}
          glyph="size-4.5"
        />
      )}
      {menu.account !== undefined && (
        <PlacePlaceholder
          label={COPY.template.account}
          glyph={avatar({ size: "bar" })}
        />
      )}
    </Placeholder>
  );
}

/** The phone bar's account place: the avatar over „Konto“, opening the account menu. */
function AccountPlace({ account: read }: { account: AccountRead }) {
  const account = use(read);
  if (account === null) return null;
  return (
    <AccountMenu
      account={account}
      accountPage={ROUTES.account.path()}
      trigger={
        <AriaButton
          data-kit-focus="inset"
          className={barPlace({ current: false, host: "aria" })}>
          <span
            aria-hidden
            className={avatar({ size: "bar" })}>
            {initials((account.name ?? account.address).record)}
          </span>
          {COPY.template.account}
        </AriaButton>
      }
    />
  );
}

// On the dark-green band, as tall as a touch target; the chevron stands where the logo's edge would.
// The way back reads a step bolder than the band's links, being the band's one act there, and answers the pointer as they do.
const back = tv({
  base: "-ms-2 flex h-10 items-center gap-1 rounded-lg ps-1 pe-3 text-sm font-semibold text-on-brand",
  variants: {
    host: {
      link: hoverLook({ host: "link", answer: "underline" }),
      aria: hoverLook({ host: "aria", answer: "underline" }),
    },
  },
});

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
        glyph="back"
        size={18}
      />
      {COPY.shared.back}
    </>
  );

  if (guard === null) {
    return (
      <NextLink
        href={href}
        data-kit-focus="ring"
        className={back({ host: "link" })}>
        {content}
      </NextLink>
    );
  }
  return (
    <ConfirmDialog
      verb="discard"
      subject={COPY.template.changes}
      consequence={COPY.template.changesLost(guard.count)}
      tone="danger"
      onConfirm={() => {
        guard.discard();
        router.push(href);
      }}
      control={
        <AriaButton
          data-kit-focus="ring"
          className={back({ host: "aria" })}>
          {content}
        </AriaButton>
      }
    />
  );
}

/**
 * „‹ Zurück“ while the address it leads to is read, an editor's list or an area's own way back: its glyph and its
 * words as the band's bars, in the place and at the size the control takes.
 */
export function BackPlaceholder() {
  return (
    <Placeholder layoutClass={back({ class: "gap-1" })}>
      <span className={placeholderBar("size-4.5")} />
      <PlaceholderLine
        textClass="text-sm"
        words={COPY.shared.back}
      />
    </Placeholder>
  );
}

/**
 * An area's own way back once the read naming it has landed: „‹ Zurück“ to the address it answers, or `none`, the
 * logo, where it answers no address, the person having nowhere to go back to.
 */
export function ReadBack({ back, none }: { back: Promise<Route | null>; none: ReactNode }) {
  const href = use(back);
  return href === null ? none : <BackControl href={href} />;
}

/**
 * „‹ Zurück“ in an editor's band, to the list the rail marks for the editor: a record's page lies under its list,
 * so the way back is read from the address rather than declared by each editor, but for an editor whose route
 * declares the list it belongs to (`placeOf`). Where the address names the season it stands at once, as the rail's
 * entries do (`RailEntries`).
 */
export function EditorBack() {
  const groups = useContext(MenuContext)?.groups ?? [];
  return (
    <PageWait
      fallback={
        <EditorBackTo
          groups={groups}
          listless
        />
      }>
      <EditorBackTo groups={groups} />
    </PageWait>
  );
}

function EditorBackTo({ groups: given, listless }: { groups: ReadonlyArray<RailGroup>; listless?: true }) {
  const groups = useEntries(given, listless);
  const current = useCurrent(groups.flatMap((group) => group.entries));
  return current === undefined ? null : <BackControl href={current.href} />;
}

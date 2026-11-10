import { COPY } from "./copy";

import type { Copy } from "./copy";

/**
 * What a search engine may do with a page: list it (`index`, which puts it in the sitemap); fetch it without
 * listing it (`noindex`, which the page says itself, so the engine must be let in to read that); or never
 * fetch it (`disallow`, which `fl_frontend/src/app/robots.ts` says before any fetch, by the address's first
 * segment).
 */
type Crawl = "index" | "noindex" | "disallow";

/**
 * One page: the address it answers at, built from its segments, the name its tab and its strip show,
 * and what a search engine may do with it. A link takes its address from here, so each address is spelled
 * once. Next's typed routes are off (`typedRoutes` in `next.config.ts`), so the compiler does not hold a row to
 * a page; `routes.test.ts` holds the rows a mail names. A page named by its record,
 * such as a club's, holds `null`: the page hands its record's name as a title of its own (`{ record }`); so does
 * an address that renders nothing, a route handler sending the request on.
 */
export type RouteEntry = {
  readonly path: (...segments: never) => `/${string}`;
  readonly title: Copy | ((...names: never) => Copy) | null;
  readonly crawl: Crawl;
  /**
   * The menu entry the page belongs to, where its address lies under another entry's: a frame marks that entry and
   * leads back to it rather than to the entry the address lies under (`kit/navPlace.tsx :: placeOf`). `entry` is the
   * entry's row; `pattern` is the address the page answers at as its route folder writes it, each dynamic segment
   * `[name]`.
   */
  readonly place?: { readonly entry: string; readonly pattern: `/${string}` };
};

/**
 * The English words an address may carry. An address follows the code's naming rule: a segment is German only where
 * it is the league's own word, a core entity or attribute of the glossary, and every word for what the website does
 * with one is English and stands here. `fl_frontend/src/core/routes.test.ts` holds every fixed segment of every row
 * and every page to this list or to a league word, so a new word is added here, in English, or the build fails.
 * @internal
 */
export const ADDRESS_WORDS = [
  "about",
  "account",
  "address",
  "address-changes",
  "admin",
  "administrators",
  "api",
  "appearance",
  "area",
  "auth",
  "ban-list",
  "bulk",
  "client-error",
  "confirm",
  "contact",
  "continue",
  "delivery",
  "done",
  "entries",
  "erasure",
  "erasures",
  "log",
  "mail",
  "passkey",
  "search",
  "security",
  "settings",
  "signin",
  "sitemap",
  "sponsors",
  // The one exception, two German words naming no league thing: the Impressum is a duty under German law, and
  // `/impressum` and `/datenschutz` are where a German visitor looks for it and for the privacy notice.
  "impressum",
  "datenschutz",
] as const;

/**
 * Every page whose name is settled. Each segment is a league word or one of `ADDRESS_WORDS`; a page under a season
 * carries the season in its address.
 * Signed-in pages, sign-in pages and pages a mail opens are never indexed, and a signed-in page or one
 * a mail opens, whose link carries a token, is never fetched.
 */
export const ROUTES = {
  /** The landing, named by the line the footer carries; the title template adds the league's name. */
  home: { path: () => "/" as const, title: COPY.template.oberstufenliga, crawl: "index" },
  /** The season the site is on, for a link that cannot know which: its page sends the reader on to that season's Spielplan. */
  saisons: { path: () => "/saisons" as const, title: COPY.page.spielplan, crawl: "noindex" },
  // The same for the season's other pages, a fixed segment taking the address before `[saison]`.
  saisonsKORunde: { path: () => "/saisons/ko-runde" as const, title: COPY.shared.kORunde, crawl: "noindex" },
  saisonsTabelle: { path: () => "/saisons/tabelle" as const, title: COPY.page.tabelle, crawl: "noindex" },
  saisonsTeams: { path: () => "/saisons/teams" as const, title: COPY.page.teams, crawl: "noindex" },
  saisonsSpielSearch: { path: () => "/saisons/search" as const, title: COPY.page.spielSearch, crawl: "noindex" },
  spielplan: {
    path: (saison: string) => `/saisons/${saison}` as const,
    title: COPY.page.spielplan,
    crawl: "index",
  },
  tabelle: {
    path: (saison: string) => `/saisons/${saison}/tabelle` as const,
    title: COPY.page.tabelle,
    crawl: "index",
  },
  teams: {
    path: (saison: string) => `/saisons/${saison}/teams` as const,
    title: COPY.page.teams,
    crawl: "index",
  },
  /** A club's page in one season, its squad among it, named by the club. */
  team: {
    path: (saison: string, team: string) => `/saisons/${saison}/teams/${team}` as const,
    title: null,
    crawl: "index",
  },
  spiel: {
    path: (saison: string, spiel: string) => `/saisons/${saison}/spiele/${spiel}` as const,
    title: COPY.page.spiel,
    crawl: "index",
  },
  kORunde: {
    path: (saison: string) => `/saisons/${saison}/ko-runde` as const,
    title: COPY.shared.kORunde,
    crawl: "index",
  },
  /** The season's matches narrowed by what a visitor asks: a page of results, which a search engine reads but never lists. */
  spielSearch: {
    path: (saison: string) => `/saisons/${saison}/search` as const,
    title: COPY.page.spielSearch,
    crawl: "noindex",
  },
  about: { path: () => "/about" as const, title: COPY.page.about, crawl: "index" },
  contact: { path: () => "/contact" as const, title: COPY.page.contact, crawl: "index" },
  sponsors: { path: () => "/sponsors" as const, title: COPY.page.sponsors, crawl: "index" },
  legalNotice: { path: () => "/impressum" as const, title: COPY.page.legalNotice, crawl: "index" },
  privacyNotice: { path: () => "/datenschutz" as const, title: COPY.page.privacyNotice, crawl: "index" },
  /** The site's pages for a person; `/sitemap.xml` is the crawler's list (`fl_frontend/src/app/sitemap.ts`). */
  sitemap: { path: () => "/sitemap" as const, title: COPY.page.sitemap, crawl: "index" },
  /**
   * A coming season's application form, which the landing and a mail lead to. Never listed, in the sitemap or by a search
   * engine, whatever its window: the sitemap's one season is the season the site is on and not the one taking applications.
   */
  bewerbung: { path: (saison: string) => `/bewerbung/${saison}` as const, title: COPY.page.bewerbung, crawl: "noindex" },
  /** Signing in, which every page signed out offers as „Konto“. */
  signIn: { path: () => "/signin" as const, title: COPY.signIn.title, crawl: "noindex" },
  /** The passkey step a sign-in reaches where its session is to set one up, use one or is offered one. */
  signInPasskey: { path: () => "/signin/passkey" as const, title: COPY.signIn.passkeyTitle, crawl: "noindex" },
  /**
   * Where every finished sign-in step lands: a route handler, not a page, which sends the session on to the page it
   * goes to next in one redirect, so nothing renders at this address and it has no title.
   */
  signInLanding: { path: () => "/signin/continue" as const, title: null, crawl: "noindex" },

  // The pages a mail opens, each answering the token its link carries.
  addressChangeConfirmation: {
    path: () => "/confirm/address" as const,
    title: COPY.page.addressChangeConfirmation,
    crawl: "disallow",
  },
  kontaktConfirmation: { path: () => "/confirm/kontakt" as const, title: COPY.page.entryConfirmation, crawl: "disallow" },
  schiedsrichterConfirmation: {
    path: () => "/confirm/schiedsrichter" as const,
    title: COPY.page.entryConfirmation,
    crawl: "disallow",
  },
  // Session 8: the fixture mail links the team's Übersicht.
  spielbestaetigung: { path: () => "/confirm/spiel" as const, title: COPY.page.spielbestaetigung, crawl: "disallow" },
  registrierungConfirmation: {
    path: () => "/confirm/spieler" as const,
    title: COPY.page.registrierungConfirmation,
    crawl: "disallow",
  },
  accountErasure: { path: () => "/erasure" as const, title: COPY.page.accountErasure, crawl: "disallow" },
  /**
   * Where a deletion lands, a page needing no session: the deletion ends the caller's own, so its action leads here
   * rather than rendering the link's page again under a session that is gone.
   */
  accountErased: { path: () => "/erasure/done" as const, title: COPY.page.accountErasure, crawl: "disallow" },
  registrierung: { path: () => "/registrierung" as const, title: COPY.page.registrierung, crawl: "disallow" },

  /**
   * Konto, a signed-in person's own pages whatever they hold, outside every area: the list of its four pages, which a
   * phone opens on, and the four.
   */
  account: { path: () => "/account" as const, title: COPY.template.account, crawl: "disallow" },
  accountSignIn: { path: () => "/account/signin" as const, title: COPY.page.accountSignIn, crawl: "disallow" },
  accountSecurity: { path: () => "/account/security" as const, title: COPY.page.accountSecurity, crawl: "disallow" },
  accountAppearance: { path: () => "/account/appearance" as const, title: COPY.page.accountAppearance, crawl: "disallow" },
  accountEntries: { path: () => "/account/entries" as const, title: COPY.page.accountEntries, crawl: "disallow" },

  /** Where a signed-in person lands, the switch between every Funktion they hold. */
  area: { path: () => "/area" as const, title: COPY.shared.overview, crawl: "disallow" },
  // Session 8: its page is built.
  schiedsrichterOverview: {
    path: (saison: string) => `/area/schiedsrichter/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },

  teamOverview: {
    path: (team: string, saison: string) => `/area/team/${team}/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },
  // Session 8: its page is built.
  teamSpiele: {
    path: (team: string, saison: string) => `/area/team/${team}/${saison}/spiele` as const,
    title: COPY.page.spiele,
    crawl: "disallow",
  },
  teamKader: {
    path: (team: string, saison: string) => `/area/team/${team}/${saison}/kader` as const,
    title: COPY.page.teamKader,
    crawl: "disallow",
  },
  teamRegistrierungen: {
    path: (team: string, saison: string) => `/area/team/${team}/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    crawl: "disallow",
  },

  /**
   * The administration's root, which a link uses where it cannot know the season: its page sends the reader on to the
   * Übersicht of the season the site is on, as `/saisons` sends a visitor on to its Spielplan.
   */
  admin: { path: () => "/admin" as const, title: COPY.shared.overview, crawl: "disallow" },
  adminOverview: {
    path: (saison: string) => `/admin/saisons/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },
  adminSaisons: { path: () => "/admin/saisons" as const, title: COPY.page.adminSaisons, crawl: "disallow" },
  /** A season's editor, named by the season. Its address lies under the season's Übersicht, and it belongs to the list. */
  adminSaison: {
    path: (saison: string) => `/admin/saisons/${saison}/settings` as const,
    title: COPY.shared.saisonName,
    crawl: "disallow",
    place: { entry: "adminSaisons", pattern: "/admin/saisons/[saison]/settings" },
  },
  adminSpiele: {
    path: (saison: string) => `/admin/saisons/${saison}/spiele` as const,
    title: COPY.page.spiele,
    crawl: "disallow",
  },
  /**
   * A matchday's editor, named by the matchday as its tab is. Its address lies under the season's Übersicht, and it
   * belongs to the Spiele list it is opened from.
   */
  adminSpieltag: {
    path: (saison: string, spieltag: string) => `/admin/saisons/${saison}/spieltage/${spieltag}` as const,
    title: null,
    crawl: "disallow",
    place: { entry: "adminSpiele", pattern: "/admin/saisons/[saison]/spieltage/[spieltag]" },
  },
  /** The match editor, named by the match's two teams as the match's own page is. */
  adminSpiel: {
    path: (saison: string, spiel: string) => `/admin/saisons/${saison}/spiele/${spiel}` as const,
    title: COPY.page.spiel,
    crawl: "disallow",
  },
  adminSpielorte: { path: () => "/admin/spielorte" as const, title: COPY.page.adminSpielorte, crawl: "disallow" },
  /** A venue's own page, named by the venue. */
  adminSpielort: {
    path: (spielort: string) => `/admin/spielorte/${spielort}` as const,
    title: null,
    crawl: "disallow",
  },
  adminSchiedsrichter: {
    path: () => "/admin/schiedsrichter" as const,
    title: COPY.page.adminSchiedsrichter,
    crawl: "disallow",
  },
  /** A referee's own page, named by the referee: the list's word is the person's too, so the key names the record. */
  adminSchiedsrichterRecord: {
    path: (schiedsrichter: string) => `/admin/schiedsrichter/${schiedsrichter}` as const,
    title: null,
    crawl: "disallow",
  },
  // Applications, teams, squads and registrations are a season's in the data, so their lists carry the season as
  // every season page does; venues and referees are the league's and keep addresses without one.
  adminBewerbungen: {
    path: (saison: string) => `/admin/saisons/${saison}/bewerbungen` as const,
    title: COPY.page.adminBewerbungen,
    crawl: "disallow",
  },
  adminBewerbungenBulk: {
    path: (saison: string) => `/admin/saisons/${saison}/bewerbungen/bulk` as const,
    title: COPY.page.adminBewerbungenBulk,
    crawl: "disallow",
  },
  /** One application, named by its school; the list and the Übersicht's applications card open it. */
  adminBewerbung: {
    path: (saison: string, bewerbung: string) => `/admin/saisons/${saison}/bewerbungen/${bewerbung}` as const,
    title: null,
    crawl: "disallow",
  },

  adminTeams: {
    path: (saison: string) => `/admin/saisons/${saison}/teams` as const,
    title: COPY.page.teams,
    crawl: "disallow",
  },
  /** A club's editor in one season, named by the club. */
  adminTeam: {
    path: (saison: string, team: string) => `/admin/saisons/${saison}/teams/${team}` as const,
    title: null,
    crawl: "disallow",
  },
  adminSpieler: {
    path: (saison: string) => `/admin/saisons/${saison}/spieler` as const,
    title: COPY.page.adminSpieler,
    crawl: "disallow",
  },
  /** A player's editor in one season, named by the player: the list's word is the person's too, so the key names the record. */
  adminSpielerRecord: {
    path: (saison: string, spieler: string) => `/admin/saisons/${saison}/spieler/${spieler}` as const,
    title: null,
    crawl: "disallow",
  },
  adminRegistrierungen: {
    path: (saison: string) => `/admin/saisons/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    crawl: "disallow",
  },
  adminAdministrators: {
    path: () => "/admin/administrators" as const,
    title: COPY.page.adminAdministrators,
    crawl: "disallow",
  },
  adminBanList: {
    path: () => "/admin/ban-list" as const,
    title: COPY.page.adminBanList,
    crawl: "disallow",
  },
  adminErasures: {
    path: () => "/admin/erasures" as const,
    title: COPY.page.adminErasures,
    crawl: "disallow",
  },
  adminAddressChanges: {
    path: () => "/admin/address-changes" as const,
    title: COPY.page.adminAddressChanges,
    crawl: "disallow",
  },
  adminActionLog: { path: () => "/admin/log" as const, title: COPY.page.adminActionLog, crawl: "disallow" },
} as const satisfies Record<string, RouteEntry>;

/**
 * A season's public pages in the one order every frame lists them, the rail and the phone bar on a season page.
 * Each is named by its route's title.
 */
export const SAISON_PAGES = ["spielplan", "kORunde", "tabelle", "teams"] as const satisfies ReadonlyArray<keyof typeof ROUTES>;

/**
 * Each address naming no season, with the page of the season the site is on it leads to: the classic footer's „Saison“
 * group, which reads nothing, so it never waits and never goes stale. `page` is also what the sitemap page lists of
 * each season.
 */
export const SAISONLESS_PAGES = [
  { route: "saisons", page: "spielplan" },
  { route: "saisonsKORunde", page: "kORunde" },
  { route: "saisonsTabelle", page: "tabelle" },
  { route: "saisonsTeams", page: "teams" },
  { route: "saisonsSpielSearch", page: "spielSearch" },
] as const satisfies ReadonlyArray<{ route: keyof typeof ROUTES; page: keyof typeof ROUTES }>;

/** The league's own pages and its legal pages, in the order the classic footer lists them. */
export const LIGA_PAGES = ["about", "contact", "sponsors"] as const satisfies ReadonlyArray<keyof typeof ROUTES>;
export const LEGAL_PAGES = ["legalNotice", "privacyNotice"] as const satisfies ReadonlyArray<keyof typeof ROUTES>;

/** The landing's section on how a school joins the league, which a link reaches as the fragment of `ROUTES.home`. */
export const JOIN_SECTION = "bewerbung";

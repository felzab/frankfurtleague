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
 * and what a search engine may do with it. A link takes its address from here, so with typed routes
 * on, an address whose page does not exist fails where the link is written. A page named by its record, such
 * as a club's, holds `null`: the page hands its record's name as a title of its own (`{ record }`).
 */
export type RouteEntry = {
  readonly path: (...segments: never) => `/${string}`;
  readonly title: Copy | ((...names: never) => Copy) | null;
  readonly crawl: Crawl;
};

/**
 * Every page whose name is settled. A segment is German only where the glossary holds the word the
 * screen shows, and English otherwise; a page under a season carries the season in its address.
 * Signed-in pages, sign-in pages and pages a mail opens are never indexed, and a signed-in page or one
 * a mail opens, whose link carries a token, is never fetched.
 */
export const ROUTES = {
  /** The landing, named by the line the footer carries; the title template adds the league's name. */
  home: { path: () => "/" as const, title: COPY.template.oberstufenliga, crawl: "index" },
  /** The season the site is on, for a link that cannot know which: its page sends the reader on to that season's Spielplan. */
  saisons: { path: () => "/saisons" as const, title: COPY.page.spielplan, crawl: "noindex" },
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
  contact: { path: () => "/kontakt" as const, title: COPY.page.contact, crawl: "index" },
  sponsors: { path: () => "/sponsors" as const, title: COPY.page.sponsors, crawl: "index" },
  legalNotice: { path: () => "/impressum" as const, title: COPY.page.legalNotice, crawl: "index" },
  privacyNotice: { path: () => "/datenschutz" as const, title: COPY.page.privacyNotice, crawl: "index" },
  /**
   * A coming season's application form, which the landing and a mail lead to. Never in the sitemap, whose one
   * season is the season the site is on and not the one taking applications; the page names its own canonical
   * address while a window is open and asks not to be listed while none is.
   */
  // Session 6: its page is built.
  bewerbung: { path: (saison: string) => `/bewerbung/${saison}` as const, title: COPY.page.bewerbung, crawl: "noindex" },
  /** Signing in, which every page signed out offers as „Anmelden“. */
  signIn: { path: () => "/signin" as const, title: COPY.signIn.title, crawl: "noindex" },
  /** The passkey step a sign-in reaches where its session is to set one up, use one or is offered one. */
  signInPasskey: { path: () => "/signin/passkey" as const, title: COPY.signIn.passkeyTitle, crawl: "noindex" },
  /** Where every finished sign-in step lands, which sends the session on to where it goes next. */
  signInLanding: { path: () => "/signin/weiter" as const, title: COPY.signIn.landingTitle, crawl: "noindex" },

  // The pages a mail opens, each answering the token its link carries.
  addressChangeConfirmation: {
    path: () => "/bestaetigung/adresse" as const,
    title: COPY.page.addressChangeConfirmation,
    crawl: "disallow",
  },
  kontaktConfirmation: { path: () => "/bestaetigung/kontakt" as const, title: COPY.page.entryConfirmation, crawl: "disallow" },
  schiedsrichterConfirmation: {
    path: () => "/bestaetigung/schiedsrichter" as const,
    title: COPY.page.entryConfirmation,
    crawl: "disallow",
  },
  spielbestaetigung: { path: () => "/bestaetigung/spiel" as const, title: COPY.page.spielbestaetigung, crawl: "disallow" },
  registrierungConfirmation: {
    path: () => "/bestaetigung/spieler" as const,
    title: COPY.page.registrierungConfirmation,
    crawl: "disallow",
  },
  accountErasure: { path: () => "/loeschung" as const, title: COPY.page.accountErasure, crawl: "disallow" },
  registrierung: { path: () => "/registrierung" as const, title: COPY.page.registrierung, crawl: "disallow" },

  // Session 4: its page is built.
  accountSignIn: { path: () => "/bereich/konto/signin" as const, title: COPY.page.accountSignIn, crawl: "disallow" },
  // Session 4: its page is built.
  accountSecurity: { path: () => "/bereich/konto/security" as const, title: COPY.page.accountSecurity, crawl: "disallow" },
  // Session 4: its page is built.
  accountAppearance: { path: () => "/bereich/konto/appearance" as const, title: COPY.page.accountAppearance, crawl: "disallow" },
  // Session 4: its page is built.
  accountEntries: { path: () => "/bereich/konto/entries" as const, title: COPY.page.accountEntries, crawl: "disallow" },

  // Session 8: its page is built.
  schiedsrichterOverview: {
    path: (saison: string) => `/bereich/schiedsrichter/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },

  teamOverview: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },
  // Session 8: its page is built.
  teamSpiele: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/spiele` as const,
    title: COPY.page.spiele,
    crawl: "disallow",
  },
  teamKader: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/kader` as const,
    title: COPY.page.teamKader,
    crawl: "disallow",
  },
  teamRegistrierungen: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    crawl: "disallow",
  },

  // Session 5: its page is built.
  verwaltungOverview: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}` as const,
    title: COPY.shared.overview,
    crawl: "disallow",
  },
  // Session 5: its page is built.
  verwaltungSaisons: { path: () => "/bereich/verwaltung/saisons" as const, title: COPY.page.verwaltungSaisons, crawl: "disallow" },
  // Session 5: its page is built.
  verwaltungSpiele: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spiele` as const,
    title: COPY.page.spiele,
    crawl: "disallow",
  },
  /** The match editor, named by the match's two teams as the match's own page is. */
  verwaltungSpiel: {
    path: (saison: string, spiel: string) => `/bereich/verwaltung/saisons/${saison}/spiele/${spiel}` as const,
    title: COPY.page.spiel,
    crawl: "disallow",
  },
  verwaltungSpielorte: { path: () => "/bereich/verwaltung/spielorte" as const, title: COPY.page.verwaltungSpielorte, crawl: "disallow" },
  /** A venue's own page, named by the venue. */
  // Session 5: its page is built.
  verwaltungSpielort: {
    path: (spielort: string) => `/bereich/verwaltung/spielorte/${spielort}` as const,
    title: null,
    crawl: "disallow",
  },
  // Session 5: its page is built.
  verwaltungSchiedsrichter: {
    path: () => "/bereich/verwaltung/schiedsrichter" as const,
    title: COPY.page.verwaltungSchiedsrichter,
    crawl: "disallow",
  },
  // Applications, teams, squads and registrations are a season's in the data, so their lists carry the season as
  // every season page does; venues and referees are the league's and keep addresses without one.
  // Session 6: its page is built.
  verwaltungBewerbungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/bewerbungen` as const,
    title: COPY.page.verwaltungBewerbungen,
    crawl: "disallow",
  },
  // Session 6: its page is built.
  verwaltungTeams: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/teams` as const,
    title: COPY.page.teams,
    crawl: "disallow",
  },
  // Session 6: its page is built.
  verwaltungSpieler: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spieler` as const,
    title: COPY.page.verwaltungSpieler,
    crawl: "disallow",
  },
  // Session 6: its page is built.
  verwaltungRegistrierungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    crawl: "disallow",
  },
  // Session 7: its page is built.
  verwaltungAdministrators: {
    path: () => "/bereich/verwaltung/administrators" as const,
    title: COPY.page.verwaltungAdministrators,
    crawl: "disallow",
  },
  // Session 7: its page is built.
  verwaltungSperrliste: {
    path: () => "/bereich/verwaltung/sperrliste" as const,
    title: COPY.page.verwaltungSperrliste,
    crawl: "disallow",
  },
  // Session 7: its page is built.
  verwaltungErasures: {
    path: () => "/bereich/verwaltung/loeschungen" as const,
    title: COPY.page.verwaltungErasures,
    crawl: "disallow",
  },
  // Session 7: its page is built.
  verwaltungAddressChanges: {
    path: () => "/bereich/verwaltung/adressaenderungen" as const,
    title: COPY.page.verwaltungAddressChanges,
    crawl: "disallow",
  },
  // Session 7: its page is built.
  verwaltungActionLog: { path: () => "/bereich/verwaltung/log" as const, title: COPY.page.verwaltungActionLog, crawl: "disallow" },
} as const satisfies Record<string, RouteEntry>;

/**
 * A season's public pages in the one order every frame lists them: the rail and the phone bar on a season page,
 * and the classic footer's „Saison“ group. Each is named by its route's title.
 */
export const SAISON_PAGES = ["spielplan", "kORunde", "tabelle", "teams"] as const satisfies ReadonlyArray<keyof typeof ROUTES>;

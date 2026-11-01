import { COPY } from "./copy";

import type { Copy } from "./copy";

/**
 * One page: the address it answers at, built from its segments, the name its tab and its strip show,
 * and whether a search engine may list it. A link takes its address from here, so with typed routes
 * on, an address whose page does not exist fails where the link is written.
 */
export type RouteEntry = {
  readonly path: (...segments: never) => `/${string}`;
  readonly title: Copy | ((...names: never) => Copy);
  readonly indexed: boolean;
};

/**
 * Every page whose name is settled. A segment is German only where the glossary holds the word the
 * screen shows, and English otherwise; a page under a season carries the season in its address.
 * Signed-in pages, sign-in pages and pages a mail opens are never indexed.
 */
export const ROUTES = {
  spielplan: {
    path: (saison: string) => `/saisons/${saison}` as const,
    title: COPY.page.spielplan,
    indexed: true,
  },
  // Session 3: its page is built.
  tabelle: {
    path: (saison: string) => `/saisons/${saison}/tabelle` as const,
    title: COPY.page.tabelle,
    indexed: true,
  },
  // Session 3: its page is built.
  teams: {
    path: (saison: string) => `/saisons/${saison}/teams` as const,
    title: COPY.page.teams,
    indexed: true,
  },
  spiel: {
    path: (saison: string, spiel: string) => `/saisons/${saison}/spiele/${spiel}` as const,
    title: COPY.page.spiel,
    indexed: true,
  },
  // Session 3: its page is built.
  kORunde: {
    path: (saison: string) => `/saisons/${saison}/ko-runde` as const,
    title: COPY.shared.kORunde,
    indexed: true,
  },
  // Session 3: its page is built.
  spielSearch: {
    path: (saison: string) => `/saisons/${saison}/search` as const,
    title: COPY.page.spielsuche,
    indexed: true,
  },
  about: { path: () => "/about" as const, title: COPY.page.about, indexed: true },
  contact: { path: () => "/kontakt" as const, title: COPY.page.kontakt, indexed: true },
  // Session 3: its page is built.
  sponsors: { path: () => "/sponsors" as const, title: COPY.page.sponsoren, indexed: true },
  legalNotice: { path: () => "/impressum" as const, title: COPY.page.impressum, indexed: true },
  privacyNotice: { path: () => "/datenschutz" as const, title: COPY.page.datenschutz, indexed: true },
  /** Signing in, which every page signed out offers as „Anmelden“. */
  signIn: { path: () => "/signin" as const, title: COPY.anmeldung.title, indexed: false },
  /** The passkey step a sign-in reaches where its session is to set one up, use one or is offered one. */
  signInPasskey: { path: () => "/signin/passkey" as const, title: COPY.anmeldung.passkeyTitle, indexed: false },

  // Session 4: its page is built.
  accountSignIn: { path: () => "/bereich/konto/signin" as const, title: COPY.page.anmeldung, indexed: false },
  // Session 4: its page is built.
  accountSecurity: { path: () => "/bereich/konto/security" as const, title: COPY.page.sicherheit, indexed: false },
  // Session 4: its page is built.
  accountAppearance: { path: () => "/bereich/konto/appearance" as const, title: COPY.page.darstellung, indexed: false },
  // Session 4: its page is built.
  accountEntries: { path: () => "/bereich/konto/entries" as const, title: COPY.page.deineEintraege, indexed: false },

  // Session 8: its page is built.
  schiedsrichterOverview: {
    path: (saison: string) => `/bereich/schiedsrichter/${saison}` as const,
    title: COPY.shared.uebersicht,
    indexed: false,
  },

  teamOverview: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}` as const,
    title: COPY.shared.uebersicht,
    indexed: false,
  },
  // Session 8: its page is built.
  teamSpiele: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/spiele` as const,
    title: COPY.page.spiele,
    indexed: false,
  },
  teamKader: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/kader` as const,
    title: COPY.page.kader,
    indexed: false,
  },
  teamRegistrierungen: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    indexed: false,
  },

  // Session 5: its page is built.
  verwaltungOverview: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}` as const,
    title: COPY.shared.uebersicht,
    indexed: false,
  },
  // Session 5: its page is built.
  verwaltungSaisons: { path: () => "/bereich/verwaltung/saisons" as const, title: COPY.page.saisons, indexed: false },
  // Session 5: its page is built.
  verwaltungSpiele: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spiele` as const,
    title: COPY.page.spiele,
    indexed: false,
  },
  /** The match editor, named by the match's two teams as the match's own page is. */
  verwaltungSpiel: {
    path: (saison: string, spiel: string) => `/bereich/verwaltung/saisons/${saison}/spiele/${spiel}` as const,
    title: COPY.page.spiel,
    indexed: false,
  },
  verwaltungSpielorte: { path: () => "/bereich/verwaltung/spielorte" as const, title: COPY.page.spielorte, indexed: false },
  /** A venue's own page, named by the venue. */
  // Session 5: its page is built.
  verwaltungSpielort: {
    path: (spielort: string) => `/bereich/verwaltung/spielorte/${spielort}` as const,
    title: COPY.verwaltung.record,
    indexed: false,
  },
  // Session 5: its page is built.
  verwaltungSchiedsrichter: {
    path: () => "/bereich/verwaltung/schiedsrichter" as const,
    title: COPY.page.schiedsrichter,
    indexed: false,
  },
  // Applications, teams, squads and registrations are a season's in the data, so their lists carry the season as
  // every season page does; venues and referees are the league's and keep addresses without one.
  // Session 6: its page is built.
  verwaltungBewerbungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/bewerbungen` as const,
    title: COPY.page.bewerbungen,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungTeams: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/teams` as const,
    title: COPY.page.teams,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungSpieler: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spieler` as const,
    title: COPY.page.spieler,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungRegistrierungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/registrierungen` as const,
    title: COPY.page.registrierungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungAdministrators: {
    path: () => "/bereich/verwaltung/administrators" as const,
    title: COPY.page.administratoren,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungSperrliste: {
    path: () => "/bereich/verwaltung/sperrliste" as const,
    title: COPY.page.sperrliste,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungErasures: {
    path: () => "/bereich/verwaltung/loeschungen" as const,
    title: COPY.page.loeschungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungAddressChanges: {
    path: () => "/bereich/verwaltung/adressaenderungen" as const,
    title: COPY.page.adressaenderungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungActionLog: { path: () => "/bereich/verwaltung/log" as const, title: COPY.shared.protokoll, indexed: false },
} as const satisfies Record<string, RouteEntry>;

import { COPY } from "./copy";

import type { Copy } from "./copy";

/**
 * One page: the address it answers at, built from its segments, the name its tab and its strip show,
 * and whether a search engine may list it. A link takes its address from here, so with typed routes
 * on, an address whose page does not exist fails where the link is written.
 */
export type RouteEntry = {
  readonly path: (...segmente: never) => `/${string}`;
  readonly titel: Copy | ((...namen: never) => Copy);
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
    titel: COPY.seite.spielplan,
    indexed: true,
  },
  // Session 3: its page is built.
  tabelle: {
    path: (saison: string) => `/saisons/${saison}/tabelle` as const,
    titel: COPY.seite.tabelle,
    indexed: true,
  },
  // Session 3: its page is built.
  teams: {
    path: (saison: string) => `/saisons/${saison}/teams` as const,
    titel: COPY.seite.teams,
    indexed: true,
  },
  spiel: {
    path: (saison: string, spiel: string) => `/saisons/${saison}/spiele/${spiel}` as const,
    titel: COPY.seite.spiel,
    indexed: true,
  },
  // Session 3: its page is built.
  kORunde: {
    path: (saison: string) => `/saisons/${saison}/ko-runde` as const,
    titel: COPY.shared.kORunde,
    indexed: true,
  },
  // Session 3: its page is built.
  spielsuche: {
    path: (saison: string) => `/saisons/${saison}/search` as const,
    titel: COPY.seite.spielsuche,
    indexed: true,
  },
  about: { path: () => "/about" as const, titel: COPY.seite.about, indexed: true },
  kontakt: { path: () => "/kontakt" as const, titel: COPY.seite.kontakt, indexed: true },
  // Session 3: its page is built.
  sponsoren: { path: () => "/sponsors" as const, titel: COPY.seite.sponsoren, indexed: true },
  impressum: { path: () => "/impressum" as const, titel: COPY.seite.impressum, indexed: true },
  datenschutz: { path: () => "/datenschutz" as const, titel: COPY.seite.datenschutz, indexed: true },
  /** Signing in, which every page signed out offers as „Anmelden“. */
  anmeldung: { path: () => "/signin" as const, titel: COPY.anmeldung.titel, indexed: false },
  /** The passkey step a sign-in reaches where its session is to set one up, use one or is offered one. */
  signInPasskey: { path: () => "/signin/passkey" as const, titel: COPY.anmeldung.passkeyTitel, indexed: false },

  // Session 4: its page is built.
  accountSignIn: { path: () => "/bereich/konto/signin" as const, titel: COPY.seite.anmeldung, indexed: false },
  // Session 4: its page is built.
  accountSecurity: { path: () => "/bereich/konto/security" as const, titel: COPY.seite.sicherheit, indexed: false },
  // Session 4: its page is built.
  accountAppearance: { path: () => "/bereich/konto/appearance" as const, titel: COPY.seite.darstellung, indexed: false },
  // Session 4: its page is built.
  accountEntries: { path: () => "/bereich/konto/entries" as const, titel: COPY.seite.deineEintraege, indexed: false },

  // Session 8: its page is built.
  schiedsrichterOverview: {
    path: (saison: string) => `/bereich/schiedsrichter/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexed: false,
  },

  teamOverview: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexed: false,
  },
  // Session 8: its page is built.
  teamSpiele: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/spiele` as const,
    titel: COPY.seite.spiele,
    indexed: false,
  },
  teamKader: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/kader` as const,
    titel: COPY.seite.kader,
    indexed: false,
  },
  teamRegistrierungen: {
    path: (team: string, saison: string) => `/bereich/team/${team}/${saison}/registrierungen` as const,
    titel: COPY.seite.registrierungen,
    indexed: false,
  },

  // Session 5: its page is built.
  verwaltungOverview: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexed: false,
  },
  // Session 5: its page is built.
  verwaltungSaisons: { path: () => "/bereich/verwaltung/saisons" as const, titel: COPY.seite.saisons, indexed: false },
  // Session 5: its page is built.
  verwaltungSpiele: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spiele` as const,
    titel: COPY.seite.spiele,
    indexed: false,
  },
  /** The match editor, named by the match's two teams as the match's own page is. */
  verwaltungSpiel: {
    path: (saison: string, spiel: string) => `/bereich/verwaltung/saisons/${saison}/spiele/${spiel}` as const,
    titel: COPY.seite.spiel,
    indexed: false,
  },
  verwaltungSpielorte: { path: () => "/bereich/verwaltung/spielorte" as const, titel: COPY.seite.spielorte, indexed: false },
  /** A venue's own page, named by the venue. */
  // Session 5: its page is built.
  verwaltungSpielort: {
    path: (spielort: string) => `/bereich/verwaltung/spielorte/${spielort}` as const,
    titel: COPY.verwaltung.datensatz,
    indexed: false,
  },
  // Session 5: its page is built.
  verwaltungSchiedsrichter: {
    path: () => "/bereich/verwaltung/schiedsrichter" as const,
    titel: COPY.seite.schiedsrichter,
    indexed: false,
  },
  // Applications, teams, squads and registrations are a season's in the data, so their lists carry the season as
  // every season page does; venues and referees are the league's and keep addresses without one.
  // Session 6: its page is built.
  verwaltungBewerbungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/bewerbungen` as const,
    titel: COPY.seite.bewerbungen,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungTeams: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/teams` as const,
    titel: COPY.seite.teams,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungSpieler: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spieler` as const,
    titel: COPY.seite.spieler,
    indexed: false,
  },
  // Session 6: its page is built.
  verwaltungRegistrierungen: {
    path: (saison: string) => `/bereich/verwaltung/saisons/${saison}/registrierungen` as const,
    titel: COPY.seite.registrierungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungAdministratoren: {
    path: () => "/bereich/verwaltung/administrators" as const,
    titel: COPY.seite.administratoren,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungSperrliste: {
    path: () => "/bereich/verwaltung/sperrliste" as const,
    titel: COPY.seite.sperrliste,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungErasures: {
    path: () => "/bereich/verwaltung/loeschungen" as const,
    titel: COPY.seite.loeschungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungAdressaenderungen: {
    path: () => "/bereich/verwaltung/adressaenderungen" as const,
    titel: COPY.seite.adressaenderungen,
    indexed: false,
  },
  // Session 7: its page is built.
  verwaltungLog: { path: () => "/bereich/verwaltung/log" as const, titel: COPY.shared.protokoll, indexed: false },
} as const satisfies Record<string, RouteEntry>;

import { COPY } from "./copy";

import type { Copy } from "./copy";

/**
 * One page: the address it answers at, built from its segments, the name its tab and its strip show,
 * and whether a search engine may list it. A link takes its address from here, so with typed routes
 * on, an address whose page does not exist fails where the link is written.
 */
export type RouteEntry = {
  readonly pfad: (...segmente: never) => `/${string}`;
  readonly titel: Copy | ((...namen: never) => Copy);
  readonly indexiert: boolean;
};

/**
 * Every page whose name is settled. A segment is German only where the glossary holds the word the
 * screen shows, and English otherwise; a page under a season carries the season in its address.
 * Signed-in pages, sign-in pages and pages a mail opens are never indexed.
 */
export const ROUTES = {
  spielplan: {
    pfad: (saison: string) => `/saisons/${saison}` as const,
    titel: COPY.seite.spielplan,
    indexiert: true,
  },
  // Session 3: its page is built.
  tabelle: {
    pfad: (saison: string) => `/saisons/${saison}/tabelle` as const,
    titel: COPY.seite.tabelle,
    indexiert: true,
  },
  // Session 3: its page is built.
  teams: {
    pfad: (saison: string) => `/saisons/${saison}/teams` as const,
    titel: COPY.seite.teams,
    indexiert: true,
  },
  spiel: {
    pfad: (saison: string, spiel: string) => `/saisons/${saison}/spiele/${spiel}` as const,
    titel: COPY.seite.spiel,
    indexiert: true,
  },
  // Session 3: its page is built.
  kORunde: {
    pfad: (saison: string) => `/saisons/${saison}/ko-runde` as const,
    titel: COPY.shared.kORunde,
    indexiert: true,
  },
  // Session 3: its page is built.
  spielsuche: {
    pfad: (saison: string) => `/saisons/${saison}/search` as const,
    titel: COPY.seite.spielsuche,
    indexiert: true,
  },
  about: { pfad: () => "/about" as const, titel: COPY.seite.about, indexiert: true },
  kontakt: { pfad: () => "/kontakt" as const, titel: COPY.seite.kontakt, indexiert: true },
  // Session 3: its page is built.
  sponsoren: { pfad: () => "/sponsors" as const, titel: COPY.seite.sponsoren, indexiert: true },
  impressum: { pfad: () => "/impressum" as const, titel: COPY.seite.impressum, indexiert: true },
  datenschutz: { pfad: () => "/datenschutz" as const, titel: COPY.seite.datenschutz, indexiert: true },
  /** Signing in, which every page signed out offers as „Anmelden“. */
  anmeldung: { pfad: () => "/signin" as const, titel: COPY.anmeldung.titel, indexiert: false },
  /** The passkey step a sign-in reaches where its session is to set one up, use one or is offered one. */
  anmeldungPasskey: { pfad: () => "/signin/passkey" as const, titel: COPY.anmeldung.passkeyTitel, indexiert: false },

  // Session 4: its page is built.
  kontoAnmeldung: { pfad: () => "/bereich/konto/signin" as const, titel: COPY.seite.anmeldung, indexiert: false },
  // Session 4: its page is built.
  kontoSicherheit: { pfad: () => "/bereich/konto/security" as const, titel: COPY.seite.sicherheit, indexiert: false },
  // Session 4: its page is built.
  kontoDarstellung: { pfad: () => "/bereich/konto/appearance" as const, titel: COPY.seite.darstellung, indexiert: false },
  // Session 4: its page is built.
  kontoEintraege: { pfad: () => "/bereich/konto/entries" as const, titel: COPY.seite.deineEintraege, indexiert: false },

  // Session 8: its page is built.
  schiedsrichterUebersicht: {
    pfad: (saison: string) => `/bereich/schiedsrichter/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexiert: false,
  },

  teamUebersicht: {
    pfad: (team: string, saison: string) => `/bereich/team/${team}/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexiert: false,
  },
  // Session 8: its page is built.
  teamSpiele: {
    pfad: (team: string, saison: string) => `/bereich/team/${team}/${saison}/spiele` as const,
    titel: COPY.seite.spiele,
    indexiert: false,
  },
  teamKader: {
    pfad: (team: string, saison: string) => `/bereich/team/${team}/${saison}/kader` as const,
    titel: COPY.seite.kader,
    indexiert: false,
  },
  teamRegistrierungen: {
    pfad: (team: string, saison: string) => `/bereich/team/${team}/${saison}/registrierungen` as const,
    titel: COPY.seite.registrierungen,
    indexiert: false,
  },

  // Session 5: its page is built.
  verwaltungUebersicht: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}` as const,
    titel: COPY.shared.uebersicht,
    indexiert: false,
  },
  // Session 5: its page is built.
  verwaltungSaisons: { pfad: () => "/bereich/verwaltung/saisons" as const, titel: COPY.seite.saisons, indexiert: false },
  // Session 5: its page is built.
  verwaltungSpiele: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spiele` as const,
    titel: COPY.seite.spiele,
    indexiert: false,
  },
  /** The match editor, named by the match's two teams as the match's own page is. */
  verwaltungSpiel: {
    pfad: (saison: string, spiel: string) => `/bereich/verwaltung/saisons/${saison}/spiele/${spiel}` as const,
    titel: COPY.seite.spiel,
    indexiert: false,
  },
  verwaltungSpielorte: { pfad: () => "/bereich/verwaltung/spielorte" as const, titel: COPY.seite.spielorte, indexiert: false },
  /** A venue's own page, named by the venue. */
  // Session 5: its page is built.
  verwaltungSpielort: {
    pfad: (spielort: string) => `/bereich/verwaltung/spielorte/${spielort}` as const,
    titel: COPY.verwaltung.datensatz,
    indexiert: false,
  },
  // Session 5: its page is built.
  verwaltungSchiedsrichter: {
    pfad: () => "/bereich/verwaltung/schiedsrichter" as const,
    titel: COPY.seite.schiedsrichter,
    indexiert: false,
  },
  // Applications, teams, squads and registrations are a season's in the data, so their lists carry the season as
  // every season page does; venues and referees are the league's and keep addresses without one.
  // Session 6: its page is built.
  verwaltungBewerbungen: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}/bewerbungen` as const,
    titel: COPY.seite.bewerbungen,
    indexiert: false,
  },
  // Session 6: its page is built.
  verwaltungTeams: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}/teams` as const,
    titel: COPY.seite.teams,
    indexiert: false,
  },
  // Session 6: its page is built.
  verwaltungSpieler: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}/spieler` as const,
    titel: COPY.seite.spieler,
    indexiert: false,
  },
  // Session 6: its page is built.
  verwaltungRegistrierungen: {
    pfad: (saison: string) => `/bereich/verwaltung/saisons/${saison}/registrierungen` as const,
    titel: COPY.seite.registrierungen,
    indexiert: false,
  },
  // Session 7: its page is built.
  verwaltungAdministratoren: {
    pfad: () => "/bereich/verwaltung/administrators" as const,
    titel: COPY.seite.administratoren,
    indexiert: false,
  },
  // Session 7: its page is built.
  verwaltungSperrliste: {
    pfad: () => "/bereich/verwaltung/sperrliste" as const,
    titel: COPY.seite.sperrliste,
    indexiert: false,
  },
  // Session 7: its page is built.
  verwaltungLoeschungen: {
    pfad: () => "/bereich/verwaltung/loeschungen" as const,
    titel: COPY.seite.loeschungen,
    indexiert: false,
  },
  // Session 7: its page is built.
  verwaltungAdressaenderungen: {
    pfad: () => "/bereich/verwaltung/adressaenderungen" as const,
    titel: COPY.seite.adressaenderungen,
    indexiert: false,
  },
  // Session 7: its page is built.
  verwaltungProtokoll: { pfad: () => "/bereich/verwaltung/log" as const, titel: COPY.shared.protokoll, indexiert: false },
} as const satisfies Record<string, RouteEntry>;

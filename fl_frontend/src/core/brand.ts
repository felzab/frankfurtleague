export const KONTAKT_EMAIL = "kontakt@frankfurtleague.de";

export const VEREIN_NAME = "Frankfurt League e. V.";

/** Spelled once: the Impressum, the Datenschutzerklärung and every email's close render this same string. */
export const VEREIN_ANSCHRIFT = "Windmühlstraße 5, 60329 Frankfurt am Main";

/** All four, the two chairs first: any two of them represent the association jointly, so a single name would misstate who
 * binds it. Selected on `vorsitz` rather than on the word rendered, one office carrying two gendered spellings. */
export const VORSTAND = [
  { name: "David Daniel Wilbers", amt: "Vorsitzender", vorsitz: true },
  { name: "Maria-Lucia Uribe Pacheco", amt: "Vorsitzende", vorsitz: true },
  { name: "Matteo Müller", amt: "Stellvertreter", vorsitz: false },
  { name: "Janosch Weiß", amt: "Schatzmeister", vorsitz: false },
] as const;

/** The PUBLISHED origin, spelled once: a message's links stand on the serving one instead (`docs/frontend/spec.md :: I186`). */
export const SITE_URL = "https://frankfurtleague.de";

/** One spelling: the footer's mark, the contact page's channel row and the application page's invitation all press through to this. */
export const INSTAGRAM_URL = "https://www.instagram.com/frankfurt.league/";

/** What a reader sees where the profile is named rather than worn as a mark. */
export const INSTAGRAM_HANDLE = "@frankfurt.league";

export const KONTAKT_EMAIL = "kontakt@frankfurtleague.de";

export const VEREIN_NAME = "Frankfurt League e. V. i. G.";

/** Spelled once: the Impressum, the Datenschutzerklärung and every email's close render this same string. */
export const VEREIN_ANSCHRIFT = "Windmühlstraße 5, 60329 Frankfurt am Main";

/** Both, in no ranked order: each represents the association alone and with the same power, so a single name would misstate it. */
export const VERTRETUNGSBERECHTIGTE = ["David Wilbers", "Maria-Lucia Uribe"] as const;

/**
 * The site's public origin, spelled once: every absolute URL the app emits is built on it, and a
 * no-reply mail carries it as its only route back.
 */
export const SITE_URL = "https://frankfurtleague.de";

/** One spelling: the footer's mark, the contact page's channel row and the application page's invitation all press through to this. */
export const INSTAGRAM_URL = "https://www.instagram.com/frankfurt.league/";

/** What a reader sees where the profile is named rather than worn as a mark. */
export const INSTAGRAM_HANDLE = "@frankfurt.league";

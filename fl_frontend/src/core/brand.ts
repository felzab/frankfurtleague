export const KONTAKT_EMAIL = "kontakt@frankfurtleague.de";

/** The mail link to it, a literal as the two profiles' addresses are, so a link takes each as it stands. */
export const KONTAKT_MAILTO = `mailto:${KONTAKT_EMAIL}` as const;

export const VEREIN_NAME = "Frankfurt League e. V.";

/** Spelled once: the Impressum, the privacy notice and every email's close render this same string. */
export const VEREIN_ADDRESS = "Windmühlstraße 5, 60329 Frankfurt am Main";

/** All four, the two chairs first: any `VORSTAND_JOINTLY` of them represent the association jointly, so a single name would misstate who
 * binds it. Selected on `vorsitz` rather than on the word rendered, one office carrying two gendered spellings. */
export const VORSTAND = [
  { name: "David Daniel Wilbers", amt: "Vorsitzender", vorsitz: true },
  { name: "Maria-Lucia Uribe Pacheco", amt: "Vorsitzende", vorsitz: true },
  { name: "Matteo Müller", amt: "Stellvertreter", vorsitz: false },
  { name: "Janosch Weiß", amt: "Schatzmeister", vorsitz: false },
] as const;

/** How many members of `VORSTAND` act together to bind the association, as its register entry states. */
export const VORSTAND_JOINTLY = 2;

/** The association's register entry, as the Impressum states it. */
export const VEREINSREGISTER = "Vereinsregister des Amtsgerichts Frankfurt am Main, VR 17757";

/** The repository the site is built from, which the Impressum's licence note links. */
export const SOURCE_URL = "https://github.com/felzab/frankfurtleague";

/** The PUBLISHED origin, spelled once: a message's links stand on the serving one instead. */
export const SITE_URL = "https://frankfurtleague.de";

/** One spelling: the footer's mark, the contact page's channel row and the application page's invitation all press through to this. */
export const INSTAGRAM_URL = "https://www.instagram.com/frankfurt.league/";

/** What a reader sees where the profile is named rather than worn as a mark. */
export const INSTAGRAM_HANDLE = "@frankfurt.league";

/** One spelling, as Instagram's: the footers' mark and the contact page's channel row. */
export const THREADS_URL = "https://www.threads.com/@frankfurt.league";

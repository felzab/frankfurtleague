export const KONTAKT_EMAIL = "kontakt@frankfurtleague.de";

/** The mail link to it, a literal as the two profiles' addresses are, so a link takes each as it stands. */
export const KONTAKT_MAILTO = `mailto:${KONTAKT_EMAIL}` as const;

/**
 * The association's name as its register entry spells it, plain spaces throughout: the form data a machine reads
 * carries.
 */
export const VEREIN_LEGAL_NAME = "Frankfurt League e. V.";

// The same name on a screen or in a mail, „e. V.“ held together by a no-break space, so a line never ends between its
// two parts.
export const VEREIN_NAME = "Frankfurt League e.\u00A0V.";

export const VEREIN_ADDRESS = "Windmühlstraße 5, 60329 Frankfurt am Main";

/**
 * All four, the two chairs first: any `VORSTAND_JOINTLY` of them represent the association jointly, so a single name
 * would misstate who binds it. Selected on `vorsitz` rather than on the word rendered, one office carrying two gendered
 * spellings.
 */
export const VORSTAND = [
  { name: "David Daniel Wilbers", amt: "Vorsitzender", vorsitz: true },
  { name: "Maria-Lucia Uribe Pacheco", amt: "Vorsitzende", vorsitz: true },
  { name: "Matteo Müller", amt: "Stellvertreter", vorsitz: false },
  { name: "Janosch Weiß", amt: "Schatzmeister", vorsitz: false },
] as const;

/** How many members of `VORSTAND` act together to bind the association, as its register entry states. */
export const VORSTAND_JOINTLY = 2;

export const VEREINSREGISTER = "Vereinsregister des Amtsgerichts Frankfurt am Main, VR 17757";

export const SOURCE_URL = "https://github.com/felzab/frankfurtleague";

/**
 * The brand's solid green, `--brand-solid` in `tokens.css`, copied once into TypeScript because neither the web app's
 * manifest nor a mail can resolve a CSS token.
 */
export const BRAND_SOLID = "#033f11";

/** The site's one language, as the document declares it and every date, number and list is formatted in. */
export const SITE_LOCALE = "de-DE";

/** The published origin: a message's links stand on the serving one instead. */
export const SITE_URL = "https://frankfurtleague.de";

export const INSTAGRAM_URL = "https://www.instagram.com/frankfurt.league/";

/** What a reader sees where the profile is named rather than worn as a mark. */
export const INSTAGRAM_HANDLE = "@frankfurt.league";

export const THREADS_URL = "https://www.threads.com/@frankfurt.league";

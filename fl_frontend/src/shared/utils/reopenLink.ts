import { KONTAKT_EMAIL } from "@/core/brand";

import { buildRefusal } from "./refusal";

// A module of its own so the routes and the refusal mappers behind them read these sentences without
// importing the browser's submit helper, `fl_frontend/src/shared/utils/publicSubmit.ts`.

// Every page opened by a link strips its token from the address bar, so „Lade die Seite neu“ lands a
// live link on the panel calling it void; only the link itself reopens the page.
/** What each link confirmation tells a visitor whose answer only a page older than the running one sends. */
export const ANTWORT_NEU_OEFFNEN =
  "Deine Antwort konnten wir so nicht übernehmen. Öffne den Link aus Deiner E-Mail noch einmal und antworte dort erneut.";

// Its own sentence beside `ANTWORT_NEU_OEFFNEN`, whose drifted body is another fault with the same repair:
// a reader told the words moved knows the page they read is not the one they would answer now.
/** What each link confirmation tells a visitor whose page shows words other than those the backend runs. */
export const FASSUNG_NEU_OEFFNEN =
  "Die Hinweise auf dieser Seite sind inzwischen geändert worden. Öffne den Link aus Deiner E-Mail noch einmal und antworte auf die aktuellen Hinweise.";

/** The registration page's twin of `ANTWORT_NEU_OEFFNEN`, whose link is the team's rather than a mail's. */
export const REGISTRIERUNG_NEU_OEFFNEN =
  "Deine Registrierung konnten wir so nicht übernehmen. Öffne den Link Deines Teams noch einmal und registriere Dich dort erneut.";

// Named plainly where the forms' own refusals are neutral: whoever holds a mailed link holds that
// mailbox, as a sign-in code's holder does, and the ban's own mail has already told them.
/** What each link confirmation tells a person whose address was barred after the link was mailed. */
export const LINK_ADRESSE_GESPERRT = buildRefusal({
  reason: "Deine E-Mail-Adresse ist gesperrt",
  repair: `Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}`,
});

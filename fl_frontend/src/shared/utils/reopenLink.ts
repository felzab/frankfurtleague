// A module of its own so the routes and the refusal mappers behind them read these sentences without
// importing the browser's submit helper, `fl_frontend/src/shared/utils/publicSubmit.ts`.

// Every page opened by a link strips its token from the address bar, so „Lade die Seite neu“ lands a
// live link on the panel calling it void; only the link itself reopens the page.
/** What each of the three link confirmations tells a visitor whose answer only a page older than the running one sends. */
export const ANTWORT_NEU_OEFFNEN =
  "Deine Antwort konnten wir so nicht übernehmen. Öffne den Link aus Deiner E-Mail noch einmal und antworte dort erneut.";

/** The registration page's twin of `ANTWORT_NEU_OEFFNEN`, whose link is the team's rather than a mail's. */
export const REGISTRIERUNG_NEU_OEFFNEN =
  "Deine Registrierung konnten wir so nicht übernehmen. Öffne den Link Deines Teams noch einmal und registriere Dich dort erneut.";

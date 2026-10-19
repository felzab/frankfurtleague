/**
 * Where every finished sign-in step lands: the one page that decides where a session goes next. Free
 * of `server-only` in its own module, so a client component names the page the admin guards send a refused session to.
 */
export const SIGN_IN_LANDING = "/signin/weiter";

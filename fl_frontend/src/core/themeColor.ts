/**
 * The browser bar's colour in each theme: `fl_frontend/src/app/tokens.css :: --bg-surface` per theme, copied
 * because a `<meta>` colour resolves no `var()`. The root layout's first paint picks one by the system's
 * scheme; `RootProviders` then sets the one for the theme the visitor chose.
 */
export const THEME_COLOR = { light: "#f5f5f5", dark: "#121212" } as const;

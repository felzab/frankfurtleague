/**
 * The browser bar's colour in each theme: `fl_frontend/src/app/tokens.css :: --bg-surface` per theme, copied
 * because a `<meta>` colour resolves no `var()`. Not `--bg`: the bar under the chrome is `bg-surface` on both
 * frames, and a `--bg` chrome sits 1.09:1 off it, a stripe. Nor the brand fill the manifest opens an installed
 * app on: this bar is on every screen at once, and the brand budget is salience. `RootProviders` renders it.
 */
export const THEME_COLOR = { light: "#f5f5f5", dark: "#121212" } as const;

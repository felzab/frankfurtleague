# ADR-0020 — Do not enable the React Compiler

**Status:** Accepted
**Date:** 2026-07-31
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Enabled during a performance pass, measured, and reversed by me the same day. The
inline note in `next.config.ts` was the only record until this ADR.

## Context

React 19 ships a compiler that inserts memoization automatically, removing the need to write
`useMemo` and `useCallback` by hand. Next supports it behind one config key plus a Babel plugin.

It was turned on and measured against the same build:

|                    | before  | after   |
| ------------------ | ------- | ------- |
| client JS, gzipped | 734,544 | 774,793 |
| build time         | —       | +1.3 s  |

**+40 KB gzipped on every page load.** The compiler's runtime travels with the app whether or not a
given page benefits.

What it bought: this app needed memoization in exactly **two** places — `AdminSpieleActionRequiredView`
and `AdminContextProvider`. Both are admin views, neither is on the public critical path, and both
are two-line `useMemo`s.

For scale, a separate payload finding worth 3.5 KB was rejected around the same time as not worth its
cost. This was ten times that, in the other direction.

## Decision

**Leave `reactCompiler` unset.** Write the memoization by hand, where it is needed and only there.

## Consequences

**40 KB of every page load stays spent on the app rather than on tooling** — the whole point.

**Memoization is a manual concern, so it can be forgotten.** The two hand-written `useMemo`s carry
their reasoning at the site. The cost of missing a third is a re-render, not a bug, which is why this
trade is acceptable here and would not be in an app with heavier client state.

**Turning it back on is deliberately cheap:** the one config key plus `babel-plugin-react-compiler`
as a devDependency. **Delete the two hand-written `useMemo`s at that point** rather than leaving them
beside the compiler's own.

**Reversal trigger.** Next enabling the compiler by default, or a React feature that requires
it. Re-measure rather than assuming the 40 KB still applies; it is a young compiler and its
runtime cost is expected to fall. The key would go in `fl_frontend/next.config.ts`.

## Alternatives considered

**Enable it and accept the 40 KB.** Rejected on the measurement above: the payload is paid by every
visitor to a public page, and every one of those pages is a server component tree with almost no
client state. The benefit lands entirely in the admin area, behind a login.

**Enable it only for the admin routes.** Not supported — the key is global, and the runtime is a
dependency of the client bundle rather than a per-route transform.

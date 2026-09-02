---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
---

# Ratified decisions — the frontend surface

`.claude/CLAUDE.md` §7's never-clauses whose only violator is a session inside `fl_frontend/`, its
own config files included, on §7's terms.

- **cache** — Add a granular cache tag with no `updateTag`; make base tags conditional
- **spiele** — Move the Spiel write path to `admin`; let its form read `useAdmin()`
- **spiele** — Merge the three `SpielCard` variants
- **pages** — Remove an `await connection()` before a page fetch
- **lint** — Scope a cross-feature import lint to anything but `core` and `shared`
- **cache** — Cache an admin-scoped API read
- **build** — Enable the React Compiler
- **forms** — Judge a typed field between keystrokes; return the editor to a dialog
- **spiele** — Guess a voided result rather than dry-running it; scope the undo offer to the destructive save
- **admin** — Hide a triage tab on a zero count; order sections off anything but the label table
- **finalrunden** — Write from `/admin/finalrunden`; render its wiring as cards
- **admin** — Give a shell page a second `h1`; make a sidemenu `hint` optional
- **undo** — Route-handle an undo outside a page-owned editor; revert before E592
- **saisons** — Fetch the season list when `?saison_id=` is absent; drop `resolveSaisonId`'s redirect or `SaisonSelector`'s fallback
- **spiele** — Make `ausstehend` a partition, or `computeSpielStatus` a filter
- **auth** — Add a `callbackUrl` to the sign-in redirect without the allowlist first
- **forms** — Confirm a clean save; raise the dialog on `info`; drop the undo when the dialog appears
- **swap** — Make the club editor the swap's home; grade a swap pair separately in each component
- **bracket** — Store a bracket fault; report a merely undecided placing; wrap a card without moving its role

## Styling and motion

- **heroui** — Import HeroUI's CSS as one entry point, or out of HeroUI's order
- **css** — Pick `admin.css` membership by folder name, not the import graph
- **toast** — Style a toast from CSS past the shell and the frontmost close button; call `toast` at a call site rather than `appToast`
- **css** — Leave a vendored overlay's zoom in place; write the app's scale override inside a `@layer`
- **motion** — Stop a loading indicator under reduced motion; freeze an ornament that rests visible

## Traps

`.claude/CLAUDE.md` §6's, on §6's terms: each fails silently.

- Import a HeroUI component's CSS per component, into whichever stylesheet can reach it —
  `fl_frontend/src/app/globals.css` loads on every route, `fl_frontend/src/app/admin/admin.css` only
  under `/admin`. Named in neither, the component renders unstyled while `tsc`, `next build` and
  ESLint all pass. Read [the checklist](../../docs/frontend/spec.md#111-adding-a-heroui-component)
  before writing the code.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
- Add the matching `updateTag` in the same change as any granular cache tag; a tag nothing
  invalidates is decoration.
- Never put `"use cache"` on an admin-scoped API read: the cache keys on arguments, not caller
  identity, so a cached admin read is a shared slot of authorized data, and the directive
  type-checks, lints, builds and passes every test.

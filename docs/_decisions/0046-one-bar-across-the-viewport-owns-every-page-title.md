# ADR-0046 — One bar across the viewport owns every page's title, and the navigation structure declares it

**Status:** Accepted\
**Date:** 2026-08-07\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My instruction of 2026-08-07 to give the signed-in shells one header in the shape of the
Cloudflare dashboard, with the page title shown only there and an info glyph on every page saying what
can be found or done on it — plus the instruction to verify the cleanest implementation rather than
assume the reference's, and a dozen rounds of review on the result.

## Context

A route's name was declared twice and the two were free to disagree. `SidemenuStructure` named it for
the navigation item, and a heading inside whichever view happened to render the route named it again.
**Seven of those headings were `sr-only`** — a heading nobody could see, which is also a heading nobody
would notice going stale — and the rest were spelled at four different sizes.

The sidemenu owned **two** headers, and only one of them carried a title. `SidemenuDesktopHeader` held
the brand mark for the rail; `SidemenuMobileHeader` held a hamburger and the page title for the phone.
Both were `h-(--navbar-height)` with a bottom border, so the divergence was invisible at any single
width and total across the two.

Three more defects had the same root — something was inside the panel that needed to be beside it, or
keyed on the wrong thing:

- **The theme control and the sign-out were behind a shut drawer on a phone.** They lived in the
  footer's options menu, so ending a session meant opening a navigation panel first.
- **The viewport reserved a scrollbar it could never show.** `<html>` carries
  `scrollbar-gutter: stable`, which is right for the public routes and wrong for a shell whose own
  `main` is the scroll container — about 15px of dead rail down the right of every page.
- **The drawer's slide did not animate.** The transition named `transform`, and Tailwind v4 emits
  `-translate-x-full` as the standalone `translate` property, so the panel jumped between positions.

## Decision

**One `AppTopBar` spans the viewport above both the rail and the content, and it renders the page's
only `h1`.** `fl_frontend/src/shared/components/layout/shell/AppShell.tsx` is the frame; both signed-in
layouts declare their navigation and their metadata and nothing about their geometry.

**`SidemenuStructure` is the single declaration of a route's identity.** Each entry carries `label`,
`iconName` and `hint`, and the nav item and the bar's title read the same field. Every view under the
shell lost its heading; the three detail pages that name a record rather than a section — the match
editor and the two team pages — keep theirs, demoted to `h2`, so the bar names the section and the page
names the record.

**`hint` is required and structured, not free prose.** `SidemenuHint` is a `lead` sentence, optional
`points` of `{term, detail}`, and an optional `note`. **The shape is the hierarchy**: the term is bold
and the detail is not, so a reader scans terms and stops at the one they came for. Required, because an
optional field is filled in for the first few entries and forgotten after that, and a hint present on
five pages of twelve reads as "the other seven have nothing to explain".

**The brand block is exactly the rail's width, with the rail's right border continued upward.**
`RAIL_WIDTH` is the one declaration both elements read, so the seam cannot drift, and the bar's
`border-b` meets the rail's `border-r` in a cross rather than a T. Both entries carry a base width and
its `lg:` companion: the collapsed state is a desktop state, and with only `lg:w-sidemenu-collapsed` an
admin who collapses the rail and then narrows to a phone gets a drawer with no width at all.

**Below `lg` the bar shows no brand at all** (my call). The block is the hamburger and nothing else, and
the mark — full logo and wordmark — is at the top of the drawer that button opens.

**The drawer overlays the bar rather than opening beneath it** (my call), so it stays viewport-`fixed`,
and `SidemenuDrawerHeader` gives it its own brand row and close button: while it is open, the bar's
toggle is behind it. `h-dvh` is scoped to that overlay with `lg:h-auto` — **the desktop rail must take
its height from the row**, because `h-dvh` under a 54px bar overshoots the viewport by exactly the bar
and makes the whole page scroll.

**The appearance and account controls are offered in both places** (my call). `ThemeSwitch` and
`SignOutButton` sit inline at the end of the bar, where they are reachable at every width; the
sidemenu footer keeps its options menu, its way back to the public site and its collapse toggle,
unchanged. **The sign-out's behaviour is `useSignOut`'s and is shared**, so the two placements cannot
come to mean different things — what is not shared is their appearance, because a full-width row in a
220px menu and a compact button on a 54px bar are different shapes for one action.

**`ThemeSwitch` becomes a two-option segmented group** — sun and moon, `disallowEmptySelection` — on
HeroUI's `ToggleButtonGroup`. A switch can only be read as "dark mode: on", which infers the label from
the state and says nothing about where pressing it leads; two labelled options say what both states are
and which is current.

**Both destructive controls carry their fill at rest and only ever deepen** (my call). A red that appears
on approach says nothing to a reader scanning the surface.

**A route rendering the shell releases the viewport's reserved scrollbar gutter.** One unlayered rule
keyed on `html:has([data-app-shell])`, so the public routes — which do scroll the viewport and do need
the reservation — are untouched, and nothing reaches up to mutate `<html>` imperatively.

**A list-box item's focus fill keys on `data-focus-visible`, a menu item's on `data-focused`.** A
`Select` focuses its selected option the moment the popover opens, whatever opened it, so `data-focused`
painted a fill on one row before anybody had pressed a key — read as "these items have a background"
rather than as "you are here" (my call). A menu genuinely does move focus with the pointer, so there the
attribute is right.

## Consequences

**`min-h-0` on the row between the bar and the content is load-bearing and silent when absent.** A flex
item's default `min-height` is `auto`, so without it the row grows to its content, `main`'s
`overflow-y-auto` never gets a smaller box to scroll inside, and the document scrolls instead — which
takes the bar off the top of the screen, the one thing a shell bar must not do. Measured at 1440×900:
root 900, bar 54 with `flex-shrink: 0`, row 846 at `min-height: 0`, rail 846 ending exactly at the
viewport, `main` 846 with `overflow-y: auto` and the only scroller on the page.

**The bar's height is the public top nav's, by construction rather than by coincidence.** Both are
`h-(--navbar-height)`; measured 54px on both.

**A route the navigation does not name falls back to the shell's own word** — "Admin" or
"Saisonübersicht". That reaches the match editor, which sits under `/admin/spiele/` and is no nav entry.
Its `h2` names the fixture, so nothing is unlabelled, but the bar there is less specific than on every
other route. Carrying a per-page override would mean a page writing into a client component above it,
which is the preserved-tree hazard `docs/frontend/spec.md` I24 exists about.

**The page title truncates and the info glyph never does.** On a phone the name is the part that can
afford to lose its tail; the glyph is the part whose absence would leave the page with no explanation.

**`AdminCrudShell` takes no title and no description**, and the two CRUD copy modules keep only their
search strings. A reader looking for those pages' headings will find them in
`ADMIN_SIDEMENU_STRUCTURE`.

**Two more HeroUI stylesheets ship to every route** — `toggle-button` and `toggle-button-group`, at
HeroUI's own position in the import order. They are in `globals.css` rather than `admin.css` because
`ThemeSwitch` is reachable from `TopNav` on every public route (ADR-0016, and the checklist in
`docs/frontend/overview.md`).

**The drawer's transition names `translate`.** That is the fix for the jump, and the same class of bug
is still live wherever `scale-*` is paired with a transition naming `transform` — the card recipe and
both button recipes. Left alone deliberately: it changes hover feel on every card and button in the app
and deserves its own review.

**Offering the sign-out twice means two arming states.** Arming one does not arm the other. Each
disarms on its own escape — a blur, an Escape key, the menu closing — so an armed control the user walks
away from resets itself, and the cost is confined to that.

## Alternatives considered

**A header inside the content area, beside a full-height rail** — the Linear and Stripe arrangement.
Much the smaller change: the rail keeps its brand header and its own state, and nothing about the
layout roots moves. Rejected because it keeps the two sidemenu headers and therefore the divergence that
made the phone and the desktop disagree about whether a page has a title at all.

**Keep the per-view headings and add the bar on top.** Two headings naming the same route, one of them
`sr-only`, is the state this replaces — and a second `h1` per page is an outline error rather than a
style preference.

**Move the options menu into the bar instead of offering both.** Built and reverted at my
direction: the footer menu is where the rail's own controls have always been, and the bar's inline pair
is what makes them reachable while the drawer is shut. Sharing the behaviour and not the markup is what
keeps two placements from becoming two meanings.

**Open the drawer beneath the bar, so the bar's toggle stays visible and can double as the close.**
Built and reverted at my direction. The overlay is what the drawer did before, and the close
control belongs on the panel that covers the screen.

**Drop `scrollbar-gutter` from `<html>` outright.** It would fix the dead rail in one edit and
reintroduce the layout shift on the public routes, which do scroll the viewport — the reservation is
right there and wrong only under the shell.

**Keep the list-box focus fill on `data-focused` and accept the resting tint.** That attribute is stable
across input modality, which is why it was chosen; but for a `Select` it fires without any keyboard
interaction, so it stops being a focus indicator and becomes a background. `data-focus-visible` still
covers the WCAG 2.4.7 case the rule was written for, and the pointer case is the call site's `hover:`.

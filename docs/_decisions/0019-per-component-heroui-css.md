# ADR-0019 — Import HeroUI's CSS per component, not as one entry point

**Status:** Accepted
**Date:** 2026-08-01
**Surface:** frontend

**Supersedes:** —
**Superseded by:** —
**Source:** Raised while remediating a PageSpeed report on the landing page, which billed the
stylesheet at 450 ms of render-blocking time on mobile.

## Context

`globals.css` opened with `@import "@heroui/styles"`. That entry pulls in every component the package
ships — roughly sixty — and this app renders about thirty.

The cost is not theoretical, and it is not a download cost either. Measured on the built stylesheet:
**715 KB uncompressed, of which the `components` layer alone was 554 KB.** The largest single
contributors were `range-calendar`, `color-swatch-picker`, `checkbox`, `radio`, `button-group` and
`toggle-button-group`. This app renders none of them.

Two properties make that worse than an oversized asset:

- **Tailwind does not tree-shake CSS imported from a dependency.** It cannot prove a rule is unused,
  so everything imported is emitted. There is no build flag that changes this.
- **A stylesheet is render-blocking.** Nothing paints until it has been downloaded _and parsed_, so
  the surplus is spent twice, and the parse half lands on the slowest device in the audience.

HeroUI documents a second entry point for exactly this: individual component stylesheets, imported
alongside the base and theme layers. The v3 release notes describe the goal as "ship only the CSS you
use."

## Decision

**Import HeroUI's component CSS one component at a time.** The block in `globals.css` reproduces
HeroUI's own `components/index.css` with the unrendered components removed, and carries the rules for
editing it.

Three rules govern that block:

1. **Order is load-bearing.** HeroUI's file states it: shared primitives first, then the components
   that compose them. Add an import at the position it occupies in HeroUI's file, never at the end.
2. **Import a component's CSS in the same change that first renders it** — including the
   sub-components it renders underneath. A picker is a popover plus a listbox plus a button.
3. **Verify in the browser.** Computed styles are the only evidence.

## Consequences

**The stylesheet went from 715 KB to 329 KB uncompressed, 57.5 KB to 28.0 KB over the wire.** Both
halves of the render-blocking cost fall, and the parse half is the one that matters on a mid-range
phone.

**A missing import fails silently, and this is the real price.** A component imported in TSX but
absent from the CSS block renders as an unstyled box. `tsc` passes, `next build` passes, ESLint
passes, and the defect appears only on whichever page mounts that component. There is no lint rule
that can catch it — the relationship between a TSX import and a CSS import is not expressible to any
tool the project runs.

The mitigation is procedural rather than technical, and therefore has to be repeated rather than
trusted: the checklist lives in [`docs/frontend/overview.md`](../frontend/overview.md#adding-a-heroui-component),
the block in `globals.css` carries it in its header, and **CLAUDE.md §6 requires it be restated
whenever a HeroUI component is added or considered.** Three copies is deliberate for a failure mode
with no automated net.

**Upgrading HeroUI now needs a diff of its `components/index.css`.** A new shared primitive, or a
reordering, is a change this block has to absorb by hand. This did not exist as a task before.

## Alternatives considered

**Keep the single import and accept the size.** Simplest, and it cannot break. Rejected on the
measurement: 386 KB of the parse cost is spent on components that are not merely unused but
_unreachable_ — there is no colour picker anywhere in this product, and there is no plan for one.

**Keep the single import and try to strip unused CSS at build time.** No supported mechanism exists.
Tailwind's content scanning does not apply to dependency CSS, and a general-purpose CSS pruner cannot
see components mounted conditionally at runtime — it would remove the modal's styles because no
static HTML contains a modal.

**Import per component, but list every component HeroUI ships**, so nothing can ever be missing.
Rejected as the single import with extra steps: it restores the full payload while adding the
maintenance burden this decision is paying for.

**Write a lint rule mapping TSX imports to CSS imports.** Attractive, and rejected as
disproportionate. It would need HeroUI's internal component graph to know that `Select` renders a
listbox and a popover, and that graph is not published — it would have to be hand-maintained, which
is the same problem one level removed.

## See also

- `fl_frontend/src/app/globals.css` — the import block and its three editing rules
- [`docs/frontend/overview.md`](../frontend/overview.md#adding-a-heroui-component) — the checklist
- [HeroUI v3 release notes](https://heroui.com/docs/react/releases/v3-0-0) — the documented mechanism

# ADR-0053 — A toast is built in TSX, and its duration is derived from what it says

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FE-11, widened by me the same day from "fix four defects" to a full
redesign of the toast surface.

## Context

Four defects were recorded against the toast surface and all four were re-verified on 2026-08-06.
**Three of them are HeroUI 3.2.3's own defaults rather than anything this repository wrote**, which is
what makes the fix a design question rather than a patch:

- **On touch there is no dismiss affordance at all.** `.toast__close-button` ships `opacity-0` **and**
  `pointer-events-none`, restored only by `.toast[data-frontmost="true"]:hover`. Without a hover the
  control is not merely invisible, it is unhittable, so a timed message carrying information can only
  be waited out — **WCAG 2.2.1 (Timing Adjustable)**, not a preference. The undo offer is the worst
  case: fifteen seconds whose entire point is a decision.
- **Durations are wrong by construction.** `DEFAULT_TOAST_TIMEOUT` is 4000 ms, applied to any toast
  that does not state its own. A five-sentence fault report and a one-word confirmation got the same
  clock, and the two producers that overrode it both picked 6000 ms by hand.
- **Most toasts were one unstructured title string**, with no separation between the outcome and the
  detail a reader needs in order to act.
- **Stacked toasts are clamped to the frontmost toast's height** with `overflow: hidden`.

[ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) had already shipped the shape the rest
should follow — outcome in the title, detail in the description, an action beside it — so the
structure was a precedent to follow rather than a proposal to design.

**The obvious implementation is to override HeroUI's appearance from `globals.css`, and it cannot
deliver what was asked for.** A stylesheet can recolour and resize what the library renders; it cannot
change _what_ is rendered, and the redesign moves the close button out of the corner into the row,
puts the action inside the content column, and adds a timer bar that does not exist in the library's
composition at all. Every one of those is markup.

The deeper objection is durability. `.toast`, `.toast__close-button` and `[data-frontmost]` are
vendored implementation detail, not public API. An upgrade that renames one takes the styling with it
and **reports nothing** — no type error, no lint error, no failing build, exactly the silent-failure
class this repository already fights in ADR-0019's per-component CSS imports.

## Decision

**The toast's markup is this app's, supplied through `Toast.Provider`'s `children` render function**
(`fl_frontend/src/core/providers/AppToaster.tsx`). That is HeroUI's documented extension point: the
function receives the queued toast and composes `Toast.Indicator`, `Toast.Content`, `Toast.Title`,
`Toast.Description`, `Toast.ActionButton` and `Toast.CloseButton` itself. The result is ordinary TSX
carrying ordinary utility classes, which `tsc`, ESLint and `better-tailwindcss/no-unknown-classes` all
read.

**CSS keeps exactly what has no element to hang a class on**, and that is two things:

| Stays in `globals.css`                               | Because                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.toast` and its `--<variant>` modifiers             | HeroUI writes the shell's own `class`; the render function is given no element for it                                 |
| `.toast[data-frontmost="true"] .toast__close-button` | Visibility must stay keyed on an attribute only the library sets, so stacked toasts behind the front one remain inert |

Both are written against **HeroUI 3.2.3** and both say so at the rule.

**A settled toast carries no icon, and severity is two thin marks: the border and the timer bar**
(my call, 2026-08-06, after seeing the first build). Both are the plain accent, the border at `/60`.

That is a real departure from `Callout`, which announces itself with a glyph in a tinted 36px tile, and
the difference is the surface rather than the palette. A callout sits inside a page among body text and
has to be found; a toast arrives alone over the page with the reader's eye already on it, so the tile
restated what the edge and the bar already said and spent a third of the width doing it. The tokens are
unchanged — this uses fewer of them.

**The indicator slot survives for exactly one case: a pending toast's spinner.** "Something is still
running" is the one thing no border can express, so it is the one thing that still earns a mark.

**The title is `text-foreground`, not the severity's `-strong`.** The border and the timer carry the
grade; a coloured heading on an opaque floating card reads as an alert box, and the title is the one
element whose legibility must never depend on a tint. The action button takes the brand fill every
other affirmative control on the site takes.

**A duration is derived from the message, not chosen at the call site.**
`fl_frontend/src/shared/utils/appToast.ts :: readingDuration` is `2000 ms + 55 ms per character`,
clamped to `[4000, 14000]`. A producer states a timeout only where length is not what governs —
the undo offer's decision window, and the dispatch-failure diagnosis a reader may need to transcribe.
`appToast` is also what makes `pending` correct: it passes `timeout: 0`, because HeroUI applies its
four-second default to any toast that omits one.

**The raw error string in the dispatch-failure toast stays** (ADR-0051 raised it; this reviewed it).
`actionError.ts` maps failures to generic German because the specific diagnosis belongs to the server
log — that is its own docblock's reasoning, and it holds wherever a server log exists. For a dispatch
rejection none does: the call failed in the browser, nothing was written server-side, and the only
other copy is a devtools console nobody has open. **The carve-out is the absence of a server-side
record, not the fact that it is a toast** — a failure that reached the server stays generic.

## Consequences

**The dismiss control is permanently visible and hittable on the frontmost toast**: 32×32 CSS px,
`opacity: 1`, `pointer-events: auto`, and `elementFromPoint` at its centre returns the button itself.
That clears WCAG 2.2.1 and the 24×24 target minimum of 2.5.8. Stacked toasts keep their hidden close
button, because the library's `:not([data-frontmost="true"])` rule is more specific than this one.

**The timer bar makes the remaining time visible**, animating from its own `timeout` and pausing with
`animation-play-state` while the region is hovered or focused — which is when `useToastRegion` pauses
the real timer. A pending toast has no bar, because nothing is counting down.

**The toast surface is opaque, and that is a performance constraint rather than a taste.** The first
build gave it `bg-surface/95` with `backdrop-blur-xl`, and the bar then drained in visible steps: a
blurred backdrop is re-rasterised on every frame anything above it changes, and this bar changes on
every frame for its whole life, so a 2px element was costing a full-surface blur pass per frame. An
opaque surface costs nothing per frame, and `will-change: transform` keeps the bar on its own layer.
**A future change that reintroduces `backdrop-filter` here reintroduces the stutter.**

**The stacked-toast clamp is left exactly as HeroUI ships it, and this is the one recorded defect that
was not changed.** Forcing `--front-height` to the value a live browser sets reproduces the truncation
— and measures the visible band of the toast behind at **6.4 px**. Everything the clamp cuts is
already behind the frontmost toast, and removing it would break the tidy stack edge it exists to
produce, or hide a short toast behind a tall one entirely. A clamp that distorts nothing anyone can see
is not worth trading for that.

**Twenty call sites across seven files now raise toasts through one module.** The roadmap recorded
twenty-one across eight; the eighth was `InlineCreateAutocomplete`, which no longer exists.

**The failure mode moves from silent to loud, which is the point.** A HeroUI upgrade that changes the
toast's composition now breaks a type or a lint rule in `AppToaster.tsx` instead of quietly unstyling a
notification. What it can still break silently is the two CSS rules above — so those are what an
upgrade checks, and there are two of them rather than a stylesheet's worth.

**One thing this could not verify.** The audit pane runs with `document.visibilityState === "hidden"`,
where `document.timeline.currentTime` never advances, so no CSS animation progresses. The timer bar's
configuration was verified (`15s`, `linear`, `forwards`, `origin: left`, `running`) and its dismissal
fires, but its visual drain needs one glance in a real browser.

[ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) is the undo toast whose
structure this brings the other producers to; [ADR-0023](0023-admin-only-css-split.md) is why
`toast.css` stays in `globals.css` and `admin.css` must not gain a second copy;
[ADR-0019](0019-per-component-heroui-css.md) is the per-component import rule and the
silent-failure class this decision avoids. The two halves are
`fl_frontend/src/core/providers/AppToaster.tsx` and `fl_frontend/src/shared/utils/appToast.ts`.

## Alternatives considered

**Override HeroUI's default composition from `globals.css`.** The route FE-11 originally assumed, and
what the repository did before. Rejected on both counts above: it cannot move an element the library
renders in a fixed place, and it rests entirely on vendored selectors whose renaming reports nothing.

**Fork the toast component into the repository.** Full control, and it would survive an upgrade
untouched — because it would stop receiving one. Rejected: the render prop already gives the whole
composition, and a fork inherits react-aria's queue, timers, view transitions and focus management as
this app's maintenance burden for no gain.

**A custom `ToastQueue` with an extended content type**, so a producer could carry per-toast display
data. Rejected as unnecessary: `timeout` is already on `QueuedToast`, which is the only thing the
redesign needed to read, and a second queue would strand `toast.clear()` calls against the first.

**Leave durations at each call site and simply pass longer ones.** Rejected: twenty producers each
remembering is how the four-second default came to sit under a five-sentence fault report. Deriving it
once is what makes the convention hold without anybody remembering it.

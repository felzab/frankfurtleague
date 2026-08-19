# ADR-0077 — A loading indicator keeps moving under reduced motion

**Status:** Accepted\
**Date:** 2026-08-19\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Roadmap item FE-14, and my decision of 2026-08-19 on the product question that item
left open — whether `ContentLoader`'s dots are a readout or decoration.

## Context

**The reduced-motion block sorts animation by category, and the loading indicators fell on both
sides of its line.** The block in `fl_frontend/src/app/globals.css` states its policy as "remove
movement, keep fades": entry animations lose their translate and their scale and keep the opacity
fade, the looping decorations stop entirely, and the block's own comment exempted `animate-spin` in
terms — spinners are loading feedback, not decoration. The dots of
`fl_frontend/src/shared/components/ui/ContentLoader.tsx` were listed among the selectors the block
sets `animation: none !important` on.

**Both loaders are `role="status"`, and their two shapes exist to be tellable apart.** `PageLoader`
means a whole page is loading; `ContentLoader` means the shell is painted and only the content
region is streaming, which is why the second is dots rather than a second ring. A reader with
`prefers-reduced-motion: reduce` was therefore told that a whole-page wait was running and told
nothing at all about a content-area wait: dots resting motionless are indistinguishable from a
decorative row of dots that is not saying anything.

**The exemption was recorded as one class name rather than as a rule**, so the next loading
component the app grows would have reached this same question with nothing written down to answer
it.

**A frozen animation is not always an absent one.** `fl_frontend/src/shared/components/ui/PageLoader.tsx`
draws an `animate-ping` halo behind its spinner, and Tailwind's `ping` keyframe declares only the
frames it ends on — `scale(2)` at zero opacity. Its resting state is the un-animated element itself,
a full-size `bg-brand/20` disc wider than the spinner it sits behind, and `animation: none` froze
exactly that. The reduced-motion page wait was a turning spinner inside a static collar.

**Another `animate-ping` in the app rests correctly.** The status pill on
`fl_frontend/src/app/(public)/page.tsx` pings a solid `bg-brand-solid` dot whose un-animated state
is the dot the pill is meant to show, so whatever happens to the halo, that class has to stay
stopped.

**The distinction already has a precedent in the same file.** The toast timer bar is deliberately
left running under reduced motion on the grounds that it is a timer readout rather than decoration,
which is the line this decision generalises.

## Decision

**A loading indicator keeps moving under `prefers-reduced-motion: reduce`, whatever shape it
takes.** It is feedback, and feedback that has stopped reports nothing about the wait it exists to
report. Neither `animate-loader-dot` nor `animate-spin` is on the block's selector list.

**That reaches the vendored indicator too, which is the case with the most riding on it.**
`@heroui/styles`'s `spinner.css` ships `motion-reduce:animate-none`, and `AppToaster` renders that
`Spinner` for every `appToast.pending` toast — a toast raised with `timeout: 0`, which never closes
on its own, on all seven admin undo paths. A reduced-motion admin pressing Rückgängig would be left
with a permanent toast whose only sign of life had stopped. The block restarts it from the vendor's
own `--animate-spin-fast` token, unlayered, for the reason
[ADR-0076](0076-the-arrival-language-carries-no-scale.md) gives: an unlayered declaration outranks
the components layer the vendored rule sits in, and a universal-selector rule inside that layer
would lose on specificity.

**The block's comment carries that rule, and names a class only where one is the exception.** The
next loading component reads one sentence and knows which side of the line it is on, rather than
inferring the rule from whichever classes the list happens to hold.

**An ornament around a readout is taken away for that reader rather than frozen.** `PageLoader`'s
halo carries `motion-reduce:hidden`, so under reduced motion it is not painted at all while the
spinner it surrounds keeps turning. Withholding the animation class instead leaves exactly the
static disc the freeze leaves.

**`.animate-ping` stays on the block's selector list**, because it is what stops the landing page's
status pill, whose resting state is the state to keep.

## Consequences

**An autonomous repeating animation now runs for a reader who asked for less motion.** That is the
cost, stated plainly: dots looping every 0.6s for as long as the content region is streaming, and
autonomous repetition is the vestibular trigger the rest of that block exists to remove. It is
accepted because the alternative is silence about a wait, and because this movement is small,
travels 7px in place, and is bounded by the wait itself — but it is a real regression for somebody,
not a free win.

**The boundary between readout and decoration is now a judgment every future loading component has
to make, and nothing checks it.** A component that loops because it looks alive rather than because
it is reporting something belongs on the selector list, and the only thing standing between the two
is whoever writes the next one reading the block's comment first.

**A class cannot join that selector list without checking what it rests as.** `ping` is the case in
this tree: a keyframe declaring only its end frames rests as its un-animated element, so stopping it
produces an ornament rather than an absence. The remedy for that belongs at the element, because the
block cannot tell one `animate-ping` from another.

**The reduced-motion page wait is now the spinner alone**, with no collar behind it, so both loaders
read for every reader the way they were shaped to: a turning ring against moving dots.

**The halo and the block now answer slightly different inputs, and that is worth knowing before a
motion toggle is ever built.** `globals.css`'s block is a bare `prefers-reduced-motion` media query,
while `motion-reduce:` resolves through the `@custom-variant` `@heroui/styles/variants` ships, which
fires on that media query _and_ on a `[data-reduce-motion="true"]` ancestor. Nothing in this app sets
that attribute, so the two coincide today. A user-facing motion switch that set it would hide the
halo while the block's own selectors kept running, and closing that gap is the switch's job rather
than this decision's.

## Alternatives considered

**Freeze the dots and give `ContentLoader` a static way to say it is waiting.** The other coherent
answer the roadmap entry named: keep the block's policy intact and let the component carry the
message some other way, as a line of text or a static mark. Rejected because a static mark cannot
say what a loader says — "something is happening" is carried by the happening, and a motionless
shape in an empty region reads as a page that has finished badly. The reader this is for is a
sighted one with a vestibular preference, for whom the `role="status"` and the label already on the
element do nothing. It would also have made reduced motion a different component rather than the
same component with less motion.

**Put `motion-safe:animate-ping` on the halo, matching `Error.tsx` and `NotFound.tsx`.** The
obvious repair, and it fixes nothing. Those two files put `motion-safe:animate-pulse` on a text
watermark whose un-animated state is the state they want on screen, so withholding the class
withholds the animation and nothing else. The halo's un-animated state is the disc; withholding the
class there leaves precisely what `animation: none` leaves. What the variant has to change is what
is painted, not what is animated.

**Drop `.animate-ping` from the block's selector list and let the halo's own variant carry it.**
Tidier on its face — one lever per element, and the block names one class fewer. Rejected because
the landing page's status pill is another `animate-ping` whose resting state is the one to keep, so
removing the class from the list would set that dot pinging for exactly the reader the list exists
for.

**Leave the vendored spinner frozen as HeroUI ships it.** Defensible as a boundary — the app decides
its own motion and the vendor decides theirs — and it is the reading that keeps this decision to the
two components the roadmap entry named. Rejected because it makes the rule above false on the surface
where it matters most: `appToast.pending` sets `timeout: 0` deliberately, so the toast stays until the
request answers, and the spinner is the whole of what says it has not. A rule stated "whatever shape
it takes" and then not applied to the third shape in the tree is a rule the next reader cannot trust.

**Delete the halo for everybody.** The shortest route to no frozen disc, and it costs no variant at
all. Rejected because reduced motion is a request for less motion, not a mandate to redesign a
component for the readers who did not ask.

**Slow the dots rather than stopping them.** A gentler middle that keeps something moving without
keeping all of it. Rejected because what triggers is repetition rather than speed, so a slower loop
buys nothing and holds the eye longer while saying the same thing.

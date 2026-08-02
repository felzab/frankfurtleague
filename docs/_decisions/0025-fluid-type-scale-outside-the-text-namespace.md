# ADR-0025 — The fluid type scale lives outside Tailwind's `--text-*` namespace

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Owner report, 2026-08-02 — chips on the teams pages rendering "either a blue or a gray".
Tracing that colour led to a class being deleted before it reached the browser, and the same
mechanism was then found at 51 call sites.

## Context

The app's nine fluid sizes were declared as `--text-fluid-xxs` … `--text-fluid-4xl`, which is
Tailwind's font-size namespace, so they produced the utilities `text-fluid-xxs` … `text-fluid-4xl`.

**tailwind-merge decides what a `text-*` class means from the value it recognises.** `text-xs` is a
font size; `text-brand` is a colour. `text-fluid-xxs` matches neither list, and its fallback is to
treat the class as a colour. So `text-fluid-xxs` and `text-foreground-muted` landed in the same
conflict group, tailwind-merge kept the last one, and **the other was deleted from the class string
before it was ever rendered.**

`src/shared/utils/tv.ts` already knew about this. It wrapped `createTV` with a `twMergeConfig`
registering the nine sizes under `font-size`, and `eslint.config.mjs` banned the stock `tv` import so
every recipe in the app went through it. Within the app, that worked.

**It could not reach a library.** `@heroui/styles` builds its own recipes with `tv` imported from
`tailwind-variants` at module scope, and every HeroUI component that accepts a `className` runs it
through one — `descriptionVariants({ className })`, `labelVariants({ className })`, and so on. Each
recipe captures its merge configuration when it is created. Two escape routes were tried against the
real package and both failed:

- calling the app's `createTV` with the scale registered **before** importing `@heroui/styles`;
- mutating `tailwind-variants`' exported, shared `defaultConfig` and then merging a fresh string.

In both cases HeroUI's recipes still dropped the class. There is no supported way to configure a
dependency's tailwind-merge instance from the application.

A scan of every `className` string in `src/` against HeroUI's own `descriptionVariants` found **51
call sites on HeroUI components where a class was being deleted**, plus three shared constants
(`FIELD_LABEL`, `FIELD_INPUT`, `TAB_ITEM`) whose destination the scan could not see. Roughly half lost
their size and rendered at an inherited one; the rest lost their **colour**. Nothing failed: not
`tsc`, not ESLint, not `next build`. The season selector's timespan had been rendering at a fixed
12px instead of the fluid 10→12px, and a squad list rendered a column of HeroUI's stock blue.

## Decision

**Declare the scale outside `--text-*`, and give it a class prefix no tailwind-merge instance has a
rule for.**

- The tokens are `--fl-type-xxs` … `--fl-type-4xl`, each with a `--fl-type-*--leading` companion.
  Because the namespace is unknown to Tailwind, **no `text-fluid-*` utility is generated at all.**
- Nine explicit `@utility fluid-*` blocks in `globals.css` read those tokens and set `font-size` and
  `line-height` together, so a size is still one class.
- Every usage is spelled `fluid-sm`, never `text-fluid-sm`. All 279 occurrences were migrated.
- **`src/shared/utils/tv.ts` is deleted, and so is the `no-restricted-imports` rule that enforced
  it.** The wrapper's only content was the merge config; with nothing left to register it would have
  been an indirection guarding nothing, and a lint rule pointing at it would have taught a habit with
  no reason behind it. The seven recipes import `tv` from `tailwind-variants` directly.

The property this buys is not "tailwind-merge is configured correctly" but "**tailwind-merge cannot
classify these classes at all**", which holds inside every dependency as well as in this app.

## Consequences

**The bug class is closed rather than patched.** A future `fluid-*` handed to any library component,
present or future, survives its merge — the mechanism does not depend on anyone remembering to
register anything.

**One module and one lint rule were removed rather than kept as scaffolding.** If a genuine
tailwind-merge configuration is ever needed again, reintroduce both together — a wrapper with no
config is not a place to put one later, it is a thing people delete on sight.

**A stale `text-fluid-*` styles nothing, silently.** That utility no longer exists, so a class copied
out of an old commit, an old audit report, or an LLM's memory will apply no font size and inherit one
instead. This is the sharpest edge this ADR creates. It is mitigated by there being zero occurrences
left in `src/`, and by the token block in `globals.css` saying so in bold — but it will not fail a
build.

**Two vocabularies were deliberately avoided.** Keeping `text-fluid-*` for plain DOM elements and
`fluid-*` for library components would have been a smaller diff and a permanent trap.

**Cosmetic changes shipped with the migration**, because 51 sites had been rendering at the wrong size
or colour and now render as written. The season selector's timespan is fluid rather than a fixed 12px,
which also moved `SaisonSlotSkeleton`'s geometry.

## Alternatives considered

**Register the scale with HeroUI's tailwind-merge.** The obvious fix, and impossible: the instance is
created inside the dependency at module scope and captured per recipe. Both routes to it were measured
and neither works. Recorded here so nobody re-derives it.

**Type-hinted arbitrary values — `text-[length:var(--fl-type-xxs)]`.** Verified to survive HeroUI's
merge, because the `length:` hint puts the class in the font-size group explicitly. Rejected for
ergonomics: it carries no line height, so every site needs a matching `leading-*`, turning one class
into two and re-opening the drift the scale exists to prevent.

**Rename the steps to Tailwind's stock names** (`--text-xs` … carrying fluid clamps). tailwind-merge
would classify them correctly with no new vocabulary. Rejected because the scale has an `xxs` step and
stock tailwind-merge has no `text-xxs`, so the most-used step in the failing sites — `fluid-xxs` — would
have stayed broken.

**Put the size class on an inner element**, the pattern `SpielStatusChip` had arrived at by accident.
Works, needs no new CSS, and was rejected because it means an extra wrapper node at ~51 sites, several
of which (`Label`, `Table.Column`, `Description`) would have had their semantics or layout changed by
one.

**An ESLint rule banning `text-fluid-*` inside a HeroUI `className`.** Enforcement rather than
elimination. Rejected because the rule must resolve JSX element types to know what is a HeroUI
component, which makes it approximate and permanently maintained — against a problem that a rename
removes outright.

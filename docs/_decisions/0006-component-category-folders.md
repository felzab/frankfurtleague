# ADR-0006 — Component category folders, one extra level for multi-section forms

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger decision D5; recorded as a rule in CLAUDE.md §6

## Context

Components sat at inconsistent depths across slices: some in category folders, some flat in
`components/`, some nested two or three levels deep with no rule about when.

## Decision

**`features/<slice>/components/<category>/Component.tsx`**, where `<category>` is one of `views`,
`collections`, `forms`, `modals`, `providers`, `ui`.

**One extra level is permitted for a multi-section form** — `forms/AdminEditSpielDataForm/` is the
reference example, holding the form plus its four section files and three helpers.

Nothing nests deeper. Nothing sits flat in `components/`.

## Consequences

A component's category is inferable from its path alone, which is what makes the layout navigable
without opening files.

The exception is bounded to one level so it cannot become a general escape hatch. A form large enough to
want two extra levels is a form that should be split into separate forms.

The categories are not arbitrary — they carry different rendering constraints:

- `views` are page-level compositions, usually the thing a route renders
- `collections` place many of one thing
- `ui` are leaves
- `modals` and `forms` are overwhelmingly client components
- `providers` hold context

Knowing the category tells you roughly whether to expect `"use client"`, which matters because that
directive has a non-obvious failure mode — see [ADR-0009](0009-connection-guards-every-data-fetch.md)'s
sibling note on render props in CLAUDE.md's repo-specific traps.

## Alternatives considered

**Flat `components/` per slice.** Rejected: a slice like `spiele` has nineteen components, and a flat
directory gives a reader no signal about which are pages, which are leaves, and which carry client
state.

**Category folders with no exception at all.** Rejected: `AdminEditSpielDataForm` is one form split
across four section files plus helpers, and flattening those into `forms/` would mix eight files
belonging to one component with the other forms in the slice.

**Unlimited nesting where it seems natural.** Rejected: that is the state this decision replaced.
"Where it seems natural" produced three different depths for the same kind of thing.

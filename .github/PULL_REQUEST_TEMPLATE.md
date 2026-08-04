<!--
The form lives in docs/workflows/message-templates.md; this pre-fills it and follows it. Delete a
heading rather than leaving it empty, and delete this comment. Title convention: `Scope: what
changed`.

This body summarises the branch; it never indexes the branch's commits (ADR-0036). The Commits tab
above is already that index. Never write one line per commit.

This body must stand alone: docs/audit/ is gitignored, so a reviewer can see neither the
remediation ledger nor the wave reports. Never point at them from here.
-->

One orientation sentence, for a multi-commit PR only: how many commits there are and what they do,
grouped by theme rather than listed one per line. Name a commit's SHA only where a reader has to
find that specific commit. Delete this line on a single-commit PR.

What the branch achieves as a whole, at a level the individual commits do not — one or two
paragraphs. For a single-commit PR, this is the whole body, and the commit's own body already says
most of it.

**Verified.** The `./scripts/verify.sh` invocation — its scopes and its exit code — and the parts
worth naming, with numbers. Plus any manual check and its result. Say plainly what could not be
verified, and why.

**Decisions taken.** Anything where a person chose between real options, with the reasoning.
Divergences resolved during the work belong here too.

**Left undone.** Explicitly, with the reason.

**Governed by.** Links to any ADR the change touches.

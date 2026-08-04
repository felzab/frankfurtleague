<!--
The form lives in docs/workflows/message-templates.md; this pre-fills it and follows it. Delete a
heading rather than leaving it empty, and delete this comment. Title convention: `Scope: what
changed`.

This body must stand alone: docs/audit/ is gitignored, so a reviewer can see neither the
remediation ledger nor the wave reports. Never point at them from here.
-->

What the branch achieves as a whole, at a level the individual commits do not — one or two
paragraphs. For a single-commit PR, the commit body already says it and a pointer is enough.

**Verified.** The `./scripts/verify.sh` invocation — its scopes and its exit code — and the parts
worth naming, with numbers. Plus any manual check and its result. Say plainly what could not be
verified, and why.

**Decisions taken.** Anything where a person chose between real options, with the reasoning.
Divergences resolved during the work belong here too.

**Left undone.** Explicitly, with the reason.

**Governed by.** Links to any ADR the change touches.

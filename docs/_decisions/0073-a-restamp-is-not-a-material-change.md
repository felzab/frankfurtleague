# ADR-0073 — A restamp is not a material change

**Status:** Accepted\
**Date:** 2026-08-09\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Roadmap item DOC-1, closed 2026-08-09

## Context

The `branch-impact` gate check holds a branch to the stamped pages its changes reach: when a
branch materially changes a file a stamped page cites, that page must be re-verified and
restamped on the same branch (CUR-4). Material is decided by the scope check's comment-only
classifier, which proves nothing about markdown — so every markdown delta counted, including a
delta that was exactly one moved stamp line.

Restamping is the remedy the check itself prescribes. A remedy that counts as a material change
re-arms the check on every stamped page citing the restamped one, so one content edit propagated
ring by ring until the citation graph closed: on 2026-08-08, one chapter edit forced eight
restamps across three rings, none of them following a change to any claim. Cheap that day, when
every page in the closure had been re-verified the day before — and priced at a real
re-verification per page on a branch cut months later. I deleted the previous staleness
mechanism, a commit-count drift ceiling, for failing branches over pages they never touched; a
check whose own remedy re-arms it fails the same way, because ring restamps demanded for no
content reason decay into the blind restamp CUR-4 forbids.

## Decision

Normalise real stamp lines out of both versions of a changed markdown file before deciding
whether it changed materially (`scripts/check_docs.py :: _stamp_only_delta`). A `Verified
against` line carrying an actual SHA is verification metadata, not content: a delta consisting
only of such lines is a restamp, arms nothing, and ends the cascade at the pages whose cited
content actually changed. A placeholder stamp line — the shape example in the currency chapter —
stays content. Everything else keeps the conservative rule: what the classifier cannot prove
comment-only is material.

## Consequences

The restamp obligation now lands once, on the change that created the staleness, and reaches
exactly one ring — the property the whole gate rework was bought for. What it costs: a page whose
only edit is its stamp no longer alerts the pages citing it. That is acceptable because nothing a
citer cites lives on the stamp line, and the stamp itself stays gated — its exact shape
(`stamp-format`), its ancestry (`stamp`), and that it moves whenever its page is edited. The
check's idea of material now differs from the scope check's by exactly this carve-out; the
divergence is deliberate, lives in one helper, and widening it needs a new decision, not an
extension of this one.

## Alternatives considered

**Keep the conservative rule.** Every markdown delta stays material, and every restamp taxes the
next ring. The tax compounds with time since the last sweep, and re-verifications demanded for no
content reason are the ones that get faked — the check would train exactly the behaviour it
exists to prevent.

**Exclude markdown from materiality entirely.** Ends the cascade and also the check's value for
the standard itself, whose chapters, index and specs cite each other as markdown. A content
change to a cited chapter must keep re-arming its citers; only the stamp line is exempt.

**A staleness ceiling counted in commits.** The mechanism this check replaced. It fired on
branches that never touched the flagged pages, which is the same crying-wolf failure in a
different shape, and re-adopting it was rejected once already.

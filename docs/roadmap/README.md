# `roadmap` — open items and future ideas

What this folder holds, and the boundary that keeps it honest:

- [`open-items.md`](open-items.md) — **known open items**: findings and undecided questions that
  have real analysis behind them but no decision yet. Each entry keeps its full reasoning, so the
  decision is taken with the analysis in hand rather than re-derived.
- Ideas and feature plans — one file per substantial idea as this folder grows.

What does **not** belong here: decided things (an ADR, `docs/_decisions/`), defects under active
remediation (the running audit programme's ledger, local-only in `docs/audit/`), and anything the
spec sheets already track as a contract.

When an item here gets decided, it leaves: the decision becomes an ADR (or just gets built), and
the entry is deleted — git history keeps the analysis.

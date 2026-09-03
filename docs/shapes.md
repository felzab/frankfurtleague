# The shapes, written out to be copied

**Purpose:** each shape [`standard.md`](standard.md) fixes and a gate check refuses, as a skeleton to
copy. Every one is a template (OUT-9), and the rule stays the standard's, where it lives exactly once
(PRE-4): where a skeleton and the standard disagree the standard wins, and a skeleton that has grown
a constraint of its own goes.

What a skeleton carries that prose cannot is the **spelling a check compares against** — a section's
exact wording, a separator character, a column count. Those are what a writer reconstructs from the
rule and gets wrong on the first run, and the gate reports them at the end of the work rather than
the start.

Every block below is fenced, so nothing in it is prose the gate reads: a check confirms these
skeletons against nothing, and the rule each cites is the only thing holding it true.

| Shape                                         | Held by                        | Refused by                                    |
| --------------------------------------------- | ------------------------------ | --------------------------------------------- |
| [A spec sheet](#a-spec-sheet)                 | OUT-4, and COR-7 for the table | `spec-spine`, `invariant-row`, `invariant-id` |
| [An overview](#an-overview)                   | OUT-5                          | `overview-spine`                              |
| [A README](#a-readme)                         | OUT-3                          | `readme-cap`                                  |
| [A module header](#a-module-header)           | INC-2, and INC-7 for placement | `module-header`, `header-see`                 |
| [What has no skeleton](#what-has-no-skeleton) | —                              | —                                             |

## A spec sheet

The four section headings are compared as literal text against
`scripts/checks/docs_gate/checks.py :: SPEC_SECTIONS`, in this order, with **no other `##` heading on
the page**: a fifth section repoints every citation of "section 3" without changing a word of one.
The arrow in the third is `→`. Contract subsections number from `1.1` upward with no gap, and an
invariant row has exactly three cells.

```
# <Surface> — spec sheet

**Scope:** <what a caller may rely on here, and what this sheet does not cover>

| Section                            | Answers                             |
| ---------------------------------- | ----------------------------------- |
| [1. Contract](#1-contract)         | <the question the contract answers> |
| [2. Invariants](#2-invariants)     | <what cannot change without notice> |
| [3. Violation → remedy](#3-violation--remedy) | <what a breach looks like, and the fix> |
| [4. Known-open](#4-known-open)     | <what is accepted rather than owed> |

## 1. Contract

### 1.1 <the first part of the surface>

<What a caller may rely on, each claim carrying an anchored citation of the symbol that delivers it.>

### 1.2 <the next part>

## 2. Invariants

| #   | Invariant                    | Enforced by       |
| --- | ---------------------------- | ----------------- |
| I1  | <what cannot become untrue>  | <check, test, type> |

## 3. Violation → remedy

| Symptom                       | Cause                  | Remedy            |
| ----------------------------- | ---------------------- | ----------------- |
| <what a reader would observe> | <the invariant broken> | <what to do>      |

## 4. Known-open

<Each accepted gap in this sheet's own words, so a known limitation never reads as an oversight.>
```

## An overview

The first `##` heading is `How it is organised` and the last is `Read next`, both compared as
literal text; between them the sections are the writer's. Mechanism belongs to the spec sheet.

```
# <Surface> — overview

<Two or three sentences: what this surface is for, and the one fact that explains most of its shape.>

## How it is organised

<The parts, and what each is responsible for. A mermaid C4 diagram belongs here where one helps.>

## <a section of the writer's own>

## Read next

<Where a reader goes for the contract, and for the surface next to this one.>
```

## A README

A closing `## Read next` is navigation rather than the one body section below, and it appears only
where the table does not already send the reader on.

```
# <Folder name>

**Folder purpose:** <what this folder holds, in one line>

## Folder overview

| Read                          | For                                       |
| ----------------------------- | ----------------------------------------- |
| [`<file>.md`](<file>.md)      | <the question this file answers>          |

## <the one thing needed before opening any of them>

<Deleted entirely where there is no such thing.>
```

## A module header

A header keeps this shape in a Python module and in a shell script, in both cases only under the
prefixes `scripts/checks/docs_gate/checks.py :: HEADER_SCOPES` names, and only for a fact attaching
to no symbol. The title's separator is a middle dot with a space on each side. `Invariants:` and
`See:` are the only labels a header may carry, every `See:` entry resolves to a file that is there,
and the block carries no drawn rule and no upper-case label row.

```sh
#!/usr/bin/env bash
# <TOKEN> · <what this module is>
#
# <Why it is shaped this way, why-first, and a sentence of plain "what" only where the file's
# contents do not carry it.>
#
# Invariants:
# - <what a change could violate silently>
# See:
# - <path/to/the/file/it/depends/on>
```

In Python the same block is the module docstring, placed above the imports (INC-7):

```python
"""<TOKEN> · <what this module is>

<Why it is shaped this way.>

Invariants:
- <what a change could violate silently>
"""
```

## What has no skeleton

- **A glossary entry**, because OUT-6 spells the heading and all four fields in its own line: a
  skeleton would be that line retyped, which is a second home (COR-2).
- **A roadmap entry**, because [`_roadmap/protocol.md`](_roadmap/protocol.md) states its shape and
  gate check `roadmap-shape` refuses a departure.
- **A rule**, because PRE-4 gives the whole shape as one line, and that line is on the page every
  rule already sits on.

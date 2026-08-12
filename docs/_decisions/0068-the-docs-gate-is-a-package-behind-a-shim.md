# ADR-0068 — The documentation gate is a package behind a shim, and the package is not called check_docs

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-10 to split `scripts/check_docs.py` into a package, taken with the
conditions the split had to meet — the shim and the package's name among them.

## Context

`scripts/check_docs.py` is what `scripts/verify.sh`'s `--docs` scope, CI and `/docs:audit` run, and
it had reached one file of 2,585 lines carrying 205 top-level symbols. Nothing in it marked where one
check's concern ended and the next began, so a check could reach across a seam and nothing said which
seam a change sat in. That much is the ordinary case for making a module a package, and on its own it
would need no decision.

What needs one is the name. The gate answers a `<file> :: <symbol>` citation by finding the symbol's
own text inside the file the citation names (`scripts/docs_gate/references.py :: _check_citation`),
so a citation of this file is a claim about that file's text rather than about where the symbol is
defined. Documents, command files and sibling checkers all cite it that way, and one of them is
[ADR-0059](0059-a-restamp-is-not-a-material-change.md), which cites
`scripts/check_docs.py :: _stamp_only_delta`.

That citation is the constraint everything below follows from.
[DEC-4](../_standard/chapters/4-decisions.md#dec-4--immutability) makes a merged ADR's reasoning
immutable, and exempts a reference repair the gate demands — a clause written for a reference that
stopped resolving on its own, because something else moved a path or renamed an identifier. A rename
here would break the reference deliberately and then claim that exemption for the repair, which is a
different act wearing the same words.

The package's own name carries a smaller trap of its own. A package directory named `check_docs`,
sitting beside the module `scripts/check_docs.py`, takes the name from it: a directory carrying
`__init__.py` is a regular package, and the path finder answers with it before reaching the file of
that name in the same directory, so `import check_docs` returns the package and nothing is left that
could import the shim. **The qualifier is load-bearing** — a directory with no `__init__.py` is a
namespace portion, which loses to the module — and this package has one. Within the one directory it
is deterministic rather than a race, in either creation order; `sys.path` order decides only between
directories, and both names would be in `scripts/`. Probed in throwaway trees, one interpreter per
case, rather than assumed.

The two import routes come apart, which is what would make it quiet.
`scripts/tests/test_check_docs.py` reaches the gate through `importlib.import_module("check_docs")`
and would be handed the package, while running the file by its path still runs the shim — so the
gate `scripts/verify.sh` invokes would go on looking healthy while the fixture net drove something
else entirely.

## Decision

**Move every check into `scripts/docs_gate/`, and leave the name the corpus already points at where
it is.**

- **`scripts/check_docs.py` stays the entry point and becomes a shim.** Its body is an import of
  every symbol the corpus cites, an `__all__` naming them, and the call into
  `scripts/checker_kernel.py :: run`. Those imports are named for export rather than for use: the
  citation check finds a symbol's text in the file it names, and the import line is that text.
- **A `check_docs.py :: <symbol>` citation is not repointed at the module that now defines the
  symbol.** It resolves, and it is true of the file it names.
- **The package is one module per seam** — the readers, caches and check registry everything else is
  built on (`kernel`), INC-2's header and INC-9's bounds (`structure`), the checks a page's kind
  decides (`perkind`), what a page points at (`references`), the checks measured against the branch
  (`branch`), and the run order and exit code (`run`). Every import arrow points kernel-ward, and
  the graph is acyclic.
- **The package is never named `check_docs`.**

## Consequences

**The shim's imports read as dead code and are load-bearing.** Nothing in the package imports them
and no call site needs them; what fails when one is deleted is the `citation` check, reported against
the citing page rather than against the shim. That is enforcement, but indirect enforcement — the
finding names the page that did the citing, and the reader has to work back to the line that answered
it. A symbol whose last citer is edited away leaves a re-export nothing holds, and nothing reports
that either.

**A citation of this file names a file that does not define its symbol.** `check_docs.py :: CHECKS`
is true, and `scripts/docs_gate/kernel.py` is where `CHECKS` is written; a reader following the
citation to reach the definition takes one step more. That is what buys ADR-0059 a citation nobody
has to touch, and the step is paid by every citer rather than by the one that cannot move.

**Renaming the shim inherits the whole problem.** Anything that moves `scripts/check_docs.py` — a
rename, a merge into another checker, a move inside the package — puts a merged ADR's citation back
in play, and no version of that is a mechanical repair.

**The package's name is held by nothing.** No check compares it against `check_docs`, and the
shadowing it avoids is silent when it happens: the import succeeds and answers with the wrong object.
What keeps the name is that it is written down here.

**A module boundary inside the package is not free to move.** Each `functools.cache` is declared in
exactly one module (`scripts/docs_gate/kernel.py`), because two declarations of one would double
every read and answer from two states — and a check cannot report a cache it is reading through.

**What the split buys is that a seam is a path.** Which module a check belongs to is answered by the
file holding it, and a change reaching across a seam shows up as an import.

## Alternatives considered

**Rename the module and repoint every citation at the module that defines its symbol.** The obvious
cleanup, and what CUR-2 asks for everywhere else: a claim about a file should be true of the file it
names in the way a reader expects. Rejected on ADR-0059. DEC-4's mechanical class would license the
repair, the reference genuinely having stopped resolving — but it stopped because this change broke
it, and reading the class that way entitles every future rename to edit the decision log. The cost of
this alternative is not the citation edits it needs; it is the immutability rule.

**Keep the shim, and repoint only the citers that may be edited.** The compromise: documents and
command files move to `scripts/docs_gate/*`, and ADR-0059's citation stays behind on the shim.
Rejected because it leaves the shim holding a single re-export with no visible reason, in a file
whose header explains a mechanism nothing else needs. One rule in two spellings also invites the next
reader to finish the job.

**Name the package `check_docs`.** The name the imports read best as, and the one a reader expects to
find beside the module. Rejected on the shadowing above: the package wins, the module beside it stops
being importable, and `scripts/tests/test_check_docs.py` is handed the package where it asked for the
gate. Nothing types, lints or builds this into a failure — the import resolves, to the wrong object.

**Break `scripts/docs_gate/references.py :: check_file` into per-seam passes as well.** The same
reasoning one level down, that one function driving a page's headers, its references and its comments
together. Rejected because nothing about the package split needs it, and it would change the order in
which a page's findings are concatenated — which the fixture net, comparing finding triples rather
than sequences, cannot see change.

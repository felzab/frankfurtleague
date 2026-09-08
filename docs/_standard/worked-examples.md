# Worked examples

**Purpose:** the applied half of [`standard.md`](standard.md). Real passages from this repository,
each shown before and after, each naming the rules that decide it. A rule's own wording is in that
file and the argument behind it in the commit that wrote it; nothing here repeats either (COR-2). A
spec-sheet row is shown without its column padding, and a single cell without its pipes.

**No example carries a word count or a percentage** (COR-5). One of them barely changes and one does
not change at all, which is the result the rules are meant to produce.

| Section                                                                                              | Answers                                                                          |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [One reason at four rungs](#one-reason-at-four-rungs-and-the-lowest-one-empties)                     | Where a reason goes when a docstring, a comment, a spec sheet and a test hold it |
| [An invariant cell keeps the contract](#an-invariant-cell-keeps-the-contract-and-lets-the-rest-move) | Which sentences leave a spec-sheet cell, and where each one lands                |
| [A paragraph loses its re-deriving tail](#a-paragraph-loses-the-tail-that-re-derives-it)             | How to tell a re-derivation from the reason a constraint exists                  |
| [An enumeration becomes a list](#an-enumeration-written-as-prose-becomes-a-list)                     | Why a change saving almost no words is still the right change                    |
| [A comment over the bound moves](#a-comment-over-the-bound-moves-rather-than-shrinking)              | What to do when every sentence earns its place and the block is still over       |
| [A block over the bound stays](#a-block-over-the-bound-can-be-finished-already)                      | When the answer to a bound is to leave the passage alone, and who may            |
| [Derivable, and not](#a-directory-answers-one-column-a-decision-answers-the-other)                   | The same table read as an inventory and read as a contract                       |
| [A file only a model reads](#a-file-only-a-model-reads-keeps-the-caveat-and-loses-the-pacing)        | What COR-15 cuts that COR-5 leaves, and what it protects harder                  |

## One reason at four rungs, and the lowest one empties

Rules: COR-14, COR-2, INC-1, INC-4, INC-8, OUT-4.

One decision — the log keeps the pre-image the update itself yields — is written at four sites. The
docstring of `fl_backend/app/core/crud.py :: patch_one_in_db`:

```python
    """`AFTER` by default: a caller echoing the pre-image would answer with the state the write just replaced.

    The driver yields ONE image, and the log takes the atomic one (`docs/backend/spec.md :: I39`).
    """
```

The comment above the call inside it:

```python
    # The update itself carries the pre-image, so nothing can land between reading it and replacing
    # it. The echo is re-read after, where a racing write costs a stale response rather than a log
    # row naming a document this write never touched.
```

I39's invariant cell in [`backend/spec.md`](../backend/spec.md#2-invariants):

```markdown
`patch_one_in_db` takes the log's pre-image from the update itself, asking the driver for `BEFORE`,
and re-reads afterwards for the document it answers the caller with. `find_one_and_update` yields one
image and not both, so one of the two has to be re-read; the log gets the atomic one because a wrong
pre-image makes a restore revert a write it never touched, while a stale echo is a response a refresh
corrects
```

And the docstring of the test in `fl_backend/tests/core/test_crud.py :: TestPatchOneInDb` that pins
it:

```python
    def test_the_log_is_given_the_image_the_update_itself_replaced(self):
        """The atomic one. A pre-image read separately could name a document another writer had already replaced."""
```

**No check sees a reason written four times.** Gate check `echo` reads a page's paragraphs and never
a comment or a docstring, and these four are paraphrases besides; COR-2 leaves both to `/docs:audit`.
Each block reads reasonably alone.

**After**, the cell holds the contract and nothing else, cut to the invariant with its argument in the
commit (OUT-4):

```markdown
`patch_one_in_db` logs the pre-image the update itself yielded and answers a re-read document: a
wrong pre-image makes a restore revert a write it never touched
```

The comment holds the constraint on the line someone would change — the
`return_document=ReturnDocument.BEFORE` argument a reader would otherwise thread through from the
signature, and the driver behaviour that forces the choice:

```python
    # `BEFORE` whatever the caller asked for: `find_one_and_update` yields one image, and only the
    # update's own is taken with the write (`docs/backend/spec.md :: I39`).
```

The docstring holds the reason for the default, which sits at no other rung:

```python
    """`AFTER` by default: a caller echoing the pre-image would answer with the state the write just replaced."""
```

And the test keeps its two assertions and loses its docstring:

```python
    def test_the_log_is_given_the_image_the_update_itself_replaced(self):
        stub = _OneDocumentCollection(STORED, pre=REPLACED)
```

**What went**

- **The docstring's second paragraph.** It names where the argument lives and then gives the
  argument (COR-2).
- **The cell's mechanism** — asking the driver for `BEFORE`, re-reading afterwards, and the driver
  yielding one image. That is how the function does its work, so it belongs at the call site
  (OUT-4), where the comment carries it.
- **The test's docstring, with nothing in its place.** Its first sentence restates the test's name
  and its second is the failure mode's fourth copy; nobody standing at that rung needs either
  (COR-2), and a docstring that would only paraphrase the name is deleted rather than shortened
  (INC-8). The rung is not emptied of the fact — the two assertions under it are the form the fact
  takes there.

**What stayed**

- **The failure mode**, at exactly one rung: a restore reverting a write it never touched. It reads
  like explanation and it is the whole reason the rule exists (COR-5).
- **The asymmetry between the two images**, which is what a caller may rely on and what no reader
  gets from the signature.
- **A citation in the comment**, so the line points at the contract rather than restating it
  (INC-6).

## An invariant cell keeps the contract and lets the rest move

Rules: OUT-4, COR-14, COR-5.

I54's invariant cell in [`backend/spec.md`](../backend/spec.md#2-invariants), before:

```markdown
A read whose order a person sees attaches `fl_backend/app/core/crud.py :: GERMAN_COLLATION` at the
call site — the collation belongs to the whole `aggregate()` or `find()`, never to the `$sort` stage
inside it, so it is passed where the read is issued and not where the pipeline is built. Mongo's
default binary collation puts „Ö“ after „Z“ and every lower-case initial after every capital, which
is wrong in a German list and wrong in a way a paginated read cannot repair on the client. It is
passed per read rather than made a default: a collated operation cannot use a simple-collation index
for a STRING bound, and the log and the application archive are read through indexes this must not
take from them
```

After:

```markdown
Every read whose order a person sees carries `fl_backend/app/core/crud.py :: GERMAN_COLLATION`, per
read and never as a default: a collated read loses a simple-collation index
```

**The rest moves rather than going**, into
[`backend/spec.md`](../backend/spec.md#3-violation--remedy), whose columns are the symptom, the cause
and the remedy:

```markdown
| A German name list is in the wrong order — „Ö“ after „Z“, every lower-case initial after every capital | The read was issued without `GERMAN_COLLATION` (I54) | Attach it to the `aggregate()` or `find()` at the call site, never to the `$sort` stage; a paginated read cannot be repaired on the client |
```

**What went**

- **"so it is passed where the read is issued and not where the pipeline is built"** — the same
  claim as the clause before it, said again from the other side (COR-5).
- **"which is wrong in a German list"** — the symbol is named `GERMAN_COLLATION`, and the sentence
  it sits in is about a German list.
- **Which indexes a default would cost**, named collection by collection. That is the reasoning
  weighed before the decision, and it goes to the commit that made it, reached with `git log -S` on
  the symbol (OUT-4).

**What stayed**

- **The refusal of the obvious simplification, in the cell**: a collated read loses a
  simple-collation index, which is what stops a reader making the collation a default (OUT-4).
- **The clause that refuses the client-side repair**, moved to the remedy column, where somebody who
  has just seen the symptom is standing.

**Two refusals, and a bounded cell holds one** (OUT-4). Which of them stays is COR-14's question and
never a length one: the reader of an invariant row is deciding whether to make the collation a
default, and the reader of a remedy row already has the wrong order in front of them.

## A paragraph loses the tail that re-derives it

Rules: COR-1, COR-5, COR-13.

From [`frontend/spec.md`](../frontend/spec.md#19-the-test-suite), before:

```markdown
**A sweep's own reader is held against a synthetic sample, not only against the tree.** A floor over
the tree guards a discovery that resolves nothing and cannot reach a second failure: where every case
in the tree is uniform, no count separates a correct reader from one that stops at the first thing it
finds. `fl_frontend/src/core/refusalPaths.test.ts` and `fl_frontend/src/core/schemaGerman.test.ts`
each run their reader over such a sample, and both keep their floors: the two answer different
questions, and the sample is the one that survives the tree becoming uniform.
```

After:

```markdown
**A sweep's own reader is held against a synthetic sample, not only against the tree.** Where every
case in the tree is uniform, no floor over the tree separates a correct reader from one that stops at
the first thing it finds. `fl_frontend/src/core/refusalPaths.test.ts` and
`fl_frontend/src/core/schemaGerman.test.ts` each run their reader over such a sample, and each keeps
its floor over the tree as well: the two answer different questions.
```

**What went**

- **"A floor over the tree guards a discovery that resolves nothing and cannot reach a second
  failure:"** The clause after the colon is the same thing in concrete terms, and its subject
  survives inside that clause.
- **"and the sample is the one that survives the tree becoming uniform"** — the closing half of the
  tail, which re-derives the failure mode the paragraph has already given in full.

**What stayed**

- **The failure mode in full**: a uniform tree lets a reader that stops at the first match pass. It
  is the only thing here a reader cannot get from the tests themselves, and the sentence that looks
  most like padding (COR-13).
- **"the two answer different questions"** — the reason both floors are kept once the sample exists,
  which is the clause that stops the next reader deleting the floor over the tree as redundant.
- **Both citations**, so each floor is checkable against the test that keeps it.

**The two halves of that tail are not the same kind of sentence.** One says why a constraint exists
and COR-5 never cuts it; the other restates a failure mode given two sentences above. A pass that
reads the tail as one unit takes both or leaves both, and both answers are wrong. The "after" also
spells its referents out — "each keeps its floor over the tree as well" rather than a pronoun and a
"too" with nothing to attach to (COR-1).

## An enumeration written as prose becomes a list

Rules: COR-8, COR-5.

From [`frontend/spec.md`](../frontend/spec.md#19-the-test-suite), before:

```markdown
**It is blind to a request made with bare `fetch`, to the runtime value inside a `${…}` hole, to a
parameter written into the endpoint literal, which carries no type to compare, and to a filter type
that neither ends in `FilterParams` nor is passed anywhere.** A path assembled outside the call
expression is not on that list, and neither is a published schema the reader cannot resolve: each is
reported and fails the run, because a call the reader cannot read is a call nothing compares.
```

After:

```markdown
**`fl_frontend/src/core/apiRequests.test.ts` is blind to:**

- a request made with bare `fetch`
- the runtime value inside a `${…}` hole
- a parameter written into the endpoint literal, which carries no type to compare
- a filter type that neither ends in `FilterParams` nor is passed anywhere

**Not on that list:** a path assembled outside the call expression, and a published schema the reader
cannot resolve — each is reported and fails the run, a call the reader cannot read being a call
nothing compares.
```

**This one barely shrinks, and it is still the change worth making.** Nothing is cut but "because",
and the pronoun opening the sentence is resolved to the file it names, since a list is entered from
its heading rather than read into from the paragraph above. What changes is that a reader checking
whether their own case is covered can find the answer without parsing a sentence to its end.

**What stayed**

- **Every member**, and the qualifier hanging off the third. An enumeration survives where the gate
  resolves every member (COR-4), and this one is closed by the reader itself.
- **"Not on that list"** and its reason. The boundary of a blindness is worth as much as the
  blindness, and it refuses the reading that anything the sweep cannot parse passes quietly.

## A comment over the bound moves rather than shrinking

Rules: INC-9, COR-14, COR-5, OUT-4.

In `fl_backend/app/shared/schemas/bounds.py`:

```python
# How old a contact person on a PUBLIC application may be, in whole years against the German day it
# arrives on. The ceiling refuses a mistyped century rather than a real age. Named so the input
# control and the Zod mirror refuse at the same two numbers.
BEWERBUNG_KONTAKT_MIN_AGE_YEARS: Final = 16
BEWERBUNG_KONTAKT_MAX_AGE_YEARS: Final = 120
```

**The block is over INC-9's bound and every sentence has an answer.** Cut the first and the age is
reckoned against whichever clock the reader reaches for, which moves a birthday by a day; cut the
second and someone reads the ceiling as a claim about human lifespan and lowers it to one; cut the
third and one tier is changed alone, so the form accepts what the API refuses.

So COR-5 takes nothing, and INC-9's first question decides instead: **two of the three sentences are
a contract.** Which day the age is reckoned against, and the agreement between the two tiers, are
what a caller may rely on — true across both surfaces and stated inside neither, which is a spec
sheet's rung and not a comment's (COR-14). The ceiling's own sentence is the line constraint, aimed
at whoever is about to change the number.

**After**, the contract is an invariant row in [`backend/spec.md`](../backend/spec.md#2-invariants),
taking one past the highest number any sheet defines, which OUT-4 then makes permanent:

```markdown
| I<n> | One age span bounds a public application's contact person at both tiers, in whole years against the German day the submission arrives on | `fl_backend/app/api/bewerbungen/schemas.py :: refuse_age_outside_the_bounds`, swept by `fl_backend/tests/api/test_bewerbung_einwilligung_refusal.py :: TestTheAgeAtConfirmation` and compared to the frontend copy by `fl_backend/tests/shared/test_frontend_mirrors.py :: test_every_declared_pair_agrees_on_the_number` |
```

and the comment is the line constraint plus the line citing the row:

```python
# The ceiling refuses a mistyped century rather than a real age (`docs/backend/spec.md :: I<n>`).
BEWERBUNG_KONTAKT_MIN_AGE_YEARS: Final = 16
BEWERBUNG_KONTAKT_MAX_AGE_YEARS: Final = 120
```

**Nothing is deleted and nothing is compressed.** Every clause of the block is still written
somewhere, in the same words, at the rung its reader stands on: someone about to edit the number
reads the comment, and someone asking what the API accepts reads the row. Trimming the block to just
under the bound instead leaves the contract at a rung nobody consults for one, which is the defect
the bound reveals rather than the repair (COR-5).

**The row's third column is where a move earns its keep.** It has to say what enforces the claim, and
here that is two tests: one sweeps the refusal, the other holds the frontend copy to the same two
numbers. A fact spread across two comments leaves a reader to find both; a row states what they
prove in one place.

## A block over the bound can be finished already

Rules: INC-9, COR-5, INC-1.

In `fl_frontend/src/shared/components/ui/AdminCrudSearch.tsx`, on the bar's own `className`:

```typescript
      // The `sm` cap is room kept for the trigger beside it. With no trigger the row is the bar's alone, so the bar takes
      // the shell's column and lines up with the table under it — `--container-page`, not the `--container-toolbar` a
      // public toolbar caps at.
      className={attachEnd ? "min-w-0 flex-1 sm:max-w-md" : "w-full min-w-0"}
```

**The block is over INC-9's bound and stays exactly as it is.** Each of that rule's three questions
answers here:

- **No invariant row would hold it.** It constrains the two class strings this one attribute picks
  between, not anything a caller of this bar may rely on.
- **Both sentences have an answer.** Cut the first and someone widens the `sm` cap, taking the room
  kept for the trigger beside it; cut the second and someone caps the trigger-less arm at
  `--container-toolbar`, which takes the bar out of line with the table below it.
- **There is no second line to send half of it to.** Both sentences are about the single ternary
  underneath.

A block that answers all three and is still over the bound cannot be made smaller without losing one
of its two halves, so it stays over it (INC-9).

**This lesson reaches an existing block, and which blocks count as existing is a matching rule
rather than a judgment.** Gate check `comment-length` holds a block the fork already carried over the
bound to the word count it ran to there rather than to the bound.
`scripts/checks/docs_gate/branch.py :: _fork_ancestor` matches a block to its earlier self by the
content lines the two share — **half of this block's own distinct lines is a match**, the largest overlap
wins, and a tie goes to the largest fork word count. The candidates are the blocks the fork held **over** the bound,
anywhere in its tree, so a block carried into a file the fork has no version of keeps its standing.
The consequences, each of which otherwise costs a rebase to discover:

- **Improving this block's opening sentence costs it nothing.** An overlap of lines is not a key on
  the first one, so the edit an over-bound block most invites is free
  (`scripts/tests/test_branch_checks.py :: test_rewriting_an_older_block_s_opening_sentence_keeps_its_standing`).
- **This block may not grow.** Its ceiling is the count it ran to at the fork rather than the bound,
  so a clause added to it fails the branch at a number the bound alone never reaches, and the finding
  names both.
- **A block is new where fewer than half its own distinct content lines sit in any one block the
  fork held over the bound, at whatever path the fork filed it under.** Padding a fresh block with a
  line lifted from a legacy one therefore buys nothing, while a block that keeps half of itself inherits
  that ceiling however differently the rest of it reads. Read a pass as the check's answer about
  matching rather than as a verdict on the prose: COR-5's test and INC-9's three questions decide
  the block, and the ceiling only says what the gate will let through.
- **The blocks in one file matching this one are charged together, against one standing for each
  copy that arrives there and never more than the fork filed in the file this one forked from — a
  rename git detects included.** Split this block in two and the halves are charged against the
  single count it ran to at the fork; copy it inside that file and leave the original standing, and
  the pair is charged the same way; a file the fork itself filed the block in twice pays for two
  where two arrive
  (`scripts/tests/test_branch_checks.py :: test_a_renamed_file_holding_two_identical_blocks_keeps_a_standing_for_each`),
  and for one where the branch deletes a copy and grows the one it keeps
  (`scripts/tests/test_branch_checks.py :: test_a_deleted_copy_leaves_its_standing_behind_rather_than_lending_it_to_the_one_that_grew`).
  The block reported is the one the branch's own diff touched, which is the half a rebase can fix
  (CUR-6).
- **A copy in another file inherits one standing and spends none of it, whatever the fork filed
  beside it.** Charging the pair across files would fail a branch for a file it never opened, so a
  block carried into a second file passes at the length its earlier self ran to and the pair is
  `/docs:audit`'s
  (`scripts/tests/test_branch_checks.py :: test_a_block_copied_into_a_second_file_spends_no_part_of_the_first_s_ceiling`),
  while two copies pasted into one are charged against that single standing
  (`scripts/tests/test_branch_checks.py :: test_a_fresh_file_holding_the_fork_s_pair_inherits_one_standing_between_the_two`).
- **A rename git does not recognise is charged as a fresh file.** The line walk keeps rename
  detection off, so the pairing comes from the diff's own rename headers; rewrite more than half of a
  file's lines while moving it and git records a deletion and an addition, so a duplicated over-bound
  block in it inherits one standing between its copies and the branch fails, loudly, where a silent
  pass would have let the second copy through
  (`scripts/tests/test_branch_checks.py :: test_a_rename_git_reads_as_a_fresh_file_charges_its_pair_against_one_standing`).
- **A truly new block comes under the bound or the gate stays red**, INC-9's stay-over-it clause
  being no answer to a gate that has already refused. Where the fact will not compress, it is at the
  wrong rung: take INC-9's first question again and move the contract half out, as the example above
  does.

**The split INC-9 asks for needs no ceiling to reach**: it puts each half at the line it constrains,
where each is a single constraint under the bound on its own.

## A directory answers one column; a decision answers the other

Rules: COR-4, COR-8, COR-5, COR-2, OUT-4.

From [`frontend/spec.md`](../frontend/spec.md#11-slice-inventory), the line above the table and four of
its rows, before:

```markdown
The Notes column lists everything a slice holds beyond the four columns and its `components/` folder.

| `saisons` | ✅ | ✅ | ✅ | ✅ | Create, edit, rollover, group swap, the Spielplan draw and its undraw — no delete, and the draw's `replace` is sent where the season already holds one; `constants.ts`, `resolvers.ts`, `saisonDraftStatus.ts`, `types.ts`, `utils.ts`, tests |
| `bewerbungen` | ✅ | ✅ | ✅ | ✅ | Triage and the public application form — an acceptance and a decline, both irreversible, plus one unauthenticated create that decides nothing; `constants.ts`, `duplicates.ts` (what the queue marks a colliding pair on), `facets.ts`, `notifications.ts` (the mail fan-out both use), `resolvers.ts`, `types.ts`, `utils.ts`, tests |
| `aktionen` | ✅ | — | — | ✅ | Read-only; the action log is written by the backend on every recorded write, never from here, and faceted by the actor's origin — an administrator, the system, or the public application form; `constants.ts`, `facets.ts`, `types.ts`, `utils.ts`, tests |
| `admin` | ✅ | — | — | — | Aggregator; `constants.ts`, `types.ts`, `utils.ts`, tests |
```

After:

```markdown
| Slice         | queries | mutations | actions | schemas | Owns, beyond the four modules and `components/`                                                                                                |
| ------------- | :-----: | :-------: | :-----: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `saisons`     |   ✅    |    ✅     |   ✅    |   ✅    | Create, edit, rollover, group swap, the Spielplan draw and its undraw — no delete, and the draw's `replace` where the season already holds one |
| `bewerbungen` |   ✅    |    ✅     |   ✅    |   ✅    | Triage, the public application form and the contact confirmation — two irreversible decisions, two unauthenticated writes                      |
| `aktionen`    |   ✅    |     —     |    —    |   ✅    | Read-only: the backend writes the log on every recorded write, never this slice, and facets it by the actor's origin                           |
| `admin`       |   ✅    |     —     |    —    |    —    | Aggregator                                                                                                                                     |
```

**What went**

- **The line above the table**, whose whole content is what one column holds. It folds into the
  column header (COR-8).
- **The per-slice module listing** — `constants.ts`, `types.ts`, `utils.ts`, a draft-status module
  and tests, row after row. The Slice column already names the folder that answers it (COR-4), and
  kept by hand the listing is accurate exactly as long as somebody keeps paying for it.
- **`aktionen`'s three origins**, which `fl_frontend/src/features/aktionen/constants.ts ::
AktionHerkunft` closes and `:: AKTION_HERKUNFT_LABELS` names, so the set is resolved in seconds
  (COR-4).

**Where the cut stops, and how to tell**

`bewerbungen` is the row that fixes the rule, because two of its entries carry a gloss: `duplicates.ts`
"(what the queue marks a colliding pair on)" and `notifications.ts` "(the mail fan-out both use)". A
folder answers neither — it lists names — so the reflex that deletes a listing wholesale would take a
claim nothing else states. **Ask of each gloss whether a lower rung answers it, and check rather than
assume**: both of these are stated at the symbol inside the module they gloss, so each copy in the
cell is deleted with nothing in its place (COR-2), and the cut runs to the end of the listing after
all. A gloss no lower rung answers does not leave with the names — it goes to the symbol it is about
(COR-14), which is where these two already are, and never back into the cell, which OUT-4 bounds.

**What stayed**

- **The tick-and-dash grid, which a pass reading it as an inventory deletes next.** Whether
  `aktionen` holds a `mutations.ts` today is derivable; that it will not acquire one is a decision,
  and the grid is where that decision is written. Read as a listing the column is redundant, read as
  a contract it is the point, and the reading that refuses something wins.
- **Every cell that refuses something** — `saisons`' "no delete", `aktionen`'s "never this slice",
  `bewerbungen`'s "both irreversible". Each is a rule a session would otherwise break, and none is
  derivable.
- **The German exactly as it stands.** "Spielplan" in the `saisons` cell is
  [`glossary.md`](../glossary.md)'s term, and a German compound means something other than its parts,
  so replacing one with an English gloss drops the trap the glossary exists to carry.

## A file only a model reads keeps the caveat and loses the pacing

Rules: COR-15, COR-2, COR-5.

The opening of `.claude/commands/docs/audit-pr.md`, a command file whose only reader is a model,
before:

```markdown
Audit the documentation this branch touches — and only that — against `docs/_standard/standard.md`, and fix what
fails **on the branch itself**. It takes no arguments (`$ARGUMENTS`): the branch in the working tree
is the scope.

This is the pre-merge slice, and it inverts `/docs:audit`'s split: the sweep reports and this command
repairs in place. On `main`, or with nothing changed since the fork point, say there is no slice and
stop.
```

After:

```markdown
Audit the documentation this branch touches — and only that — against `docs/_standard/standard.md`, and fix what
fails **on the branch itself**. It takes no arguments (`$ARGUMENTS`): the branch in the working tree
is the scope. On `main`, or with nothing changed since the fork point, say there is no slice and
stop.
```

**What went**

- **"This is the pre-merge slice, and it inverts `/docs:audit`'s split: the sweep reports and this
  command repairs in place."** The sentence before it already says this command fixes, and the step
  that does the fixing says it a third time (COR-2). What the sentence adds is orientation — where
  this command sits among its siblings — which is a person's need when choosing between two of them
  and no part of the work of the model that has already been handed one. It is paid on every
  invocation (COR-15).

**What stayed**

- **"On `main`, or with nothing changed since the fork point, say there is no slice and stop."** It
  reads like an edge case, which is why a pass cutting for length takes it early, and it is the
  caveat that changes what the reader does.
- **"A defect that predates this branch and sits outside the subset is fixed on this branch or raised
  as a question, never filed in silence"**, further down the same file. A carve-out is what a reader who
  cannot ask walks past, and COR-15 protects one harder here than anywhere else.

**Nothing here is a length rule.** A model-only file has no cap and takes COR-5's test instead
(COR-15) — which is why the cut above is one sentence and not a paragraph, and why nothing beside it
was cut to reach a number.

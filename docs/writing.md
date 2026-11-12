# Writing

How documents, names, comments, commit messages and pull requests are written here. Prettier formats
every Markdown file, markdownlint holds it to one style, and lychee resolves every link and
`#fragment` inside the repository; the gate runs all three. This page holds what no tool checks.

## Documents

- **Describe the tree as it is, in the present tense**, naming only what exists. Never narrate an
  edit ("was changed", "no longer", "now uses") or record what was removed. A present negative is a
  fact like any other: "The list is not cached, because …".
- **Say why, not what**: the reason a reader cannot get from the code, such as why this shape was
  chosen, what breaks otherwise, or what a caller may rely on.
- **Point to code by its file path.** A line number goes stale with the next edit above it.
- **One idea per sentence.** A sentence listing several things becomes a list.
- **A heading names one topic a reader would search for**, unique in its document.
- **A table cell holds a phrase.** Data that needs sentences is a list.
- **Bold only for a run-in heading**, as here, and never capitals for emphasis.
- **Spell every domain term as [the glossary](glossary.md) does**, and check its entry before first
  writing it. A new term's entry says what the word is and where it lives in the code, nothing more.
- **A never that no check enforces is one line in [the decisions record](decisions.md)**, added in
  the commit that takes it, whose body holds its date and argument; the line has no date.
- **A route's or a published model's docstring is its published description**: one or two sentences
  of what a caller may rely on. It names no source path, rule id or refusal list, and never says how
  the code is built.

## Names

- **German only for a thing of the league itself**, as the glossary's core entities and attributes
  list them. The test: would the word stand in the league's rulebook if there were no website?
- **Everything else is English**: what the website does (an account, a sign-in, a mail, a grant),
  every verb, adjective, predicate and state, every generic noun, and every particle beside an
  English word (`_at`, `_by`, `_until`, `_from`, `_since`, `_on`, `_after`). The German a visitor
  reads is copy, not a name.
- **A page's or a mailed link's address** follows the rule segment by segment, save `/impressum` and
  `/datenschutz`, the words German law and a visitor look for
  (`fl_frontend/src/core/routes.ts :: ADDRESS_WORDS`, which `routes.test.ts` holds each address to).
- **A stored or served name** follows it too: `saison_phase`, but `first_name`, never `vorname`. A
  rename is a paste the owner runs before the deploy reading the new name, and the paste drops an
  index naming it, so the boot builds it anew. The record model
  (`fl_backend/app/readback.py :: RECORD_MODELS`) and the read-back change in the same commit.
- **A name the production host or a deploy holds**, such as a secret or a header, follows it too,
  and its rename is an owner step. A Docker volume keeps its name: renamed, it is a new, empty one.
- **A copy catalogue key is a name, never the copy it keys.** A page title's key is its route key,
  and a title several routes share is one entry keyed by its noun.
- **An English twin of a glossary noun takes the German noun**, so one search finds every site.
- **A file or folder is cased by its kind**, held by ESLint's `check-file` rules and ruff's `N999`.
  A React component's file is PascalCase after its component (`LinkRows.tsx`), another TypeScript
  module camelCase after its main export (`signInGate.ts`). Python and shell files are snake_case,
  Markdown files and folders lowercase kebab-case, and a dynamic route segment its param
  (`[saison]`). A test is named after its module; a name a tool looks for keeps it (`page.tsx`).

## Comments

**A comment is a plain sentence saying why**, at the line it explains, and only where that line is
not obvious: the constraint, the trap, or the alternative that was rejected. Deleted on sight:

- a comment restating the code
- a citation of another file, or a rule id
- a list of the code's callers ("Exported for …", "X and Y read it")
- a "for X's reason" pointer, its reason written out in a few words instead
- a header block, or any history

## Commit messages

- **The subject is `Scope: what changed`**, sentence case after the scope, no trailing period, at
  most 72 characters, where GitHub truncates a title. It says what is true once the commit lands
  ("The list pages share one loader"): no imperative, no Conventional Commits. Two related changes
  may share a subject joined by ", and".
- **The scope is one of** `Frontend`, `Backend`, `Docs`, `Repo` (the gate, the checks and their
  configuration), `Ops` (deployment, images, nginx), `CI` (`.github/workflows/`),
  `Database` (the data or its constraints), `Frontend deps` and `Backend deps`. A change reaching
  several joins them (`Backend + Frontend`), and a rename takes its area's scope. Dependabot's
  prefixes add `Frontend image` and `Backend image` for each Dockerfile's base images.
- **The body is prose wrapped at about 76 characters**, one paragraph per area, led by its area. It
  carries what the diff cannot: why, what was verified and how (with the exit code, never the word
  "passing"), where an earlier assumption was wrong, and the alternative rejected. No emoji.
- **A pushed commit message is never rewritten.** The pull request body corrects a false claim.

## Pull requests

- **The title has the commit subject's shape.** With one commit, it is that commit's subject.
- **The body summarises the branch as a whole and never lists its commits.** A body covering several
  commits opens with one sentence of orientation; `.github/pull_request_template.md` gives its
  sections.
- **The body stands alone.** It links nothing a reader of the public repository cannot open.

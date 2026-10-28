# Writing

How documents, code comments, commit messages and pull requests are written in this repository.
Prettier formats every Markdown file, markdownlint holds the Markdown to one style, and lychee
checks that every link inside the repository and every `#fragment` resolves; the gate runs all three. What no tool can
check is on this page.

## Documents and comments

- **Describe the tree as it is now, in the present tense.** Name only files, functions and
  behaviour that exist. Never narrate an edit ("was changed", "no longer", "now uses") and never
  record that something is absent. A rejected alternative is written as a present constraint aimed
  at whoever would propose it again: "The list is not cached, because …".
- **Say why, not what.** The code says what it does. Write the reason a reader cannot get from the
  code: why this shape was chosen, what breaks otherwise, what a caller may rely on.
- **Point to code by its file path.** A line number goes stale with the next edit above it.
- **Spell every domain term as [the glossary](glossary.md) does**, and read a term's entry before
  writing it for the first time. A new term gets an entry, which says what the word is and where it
  lives in the code, and nothing more.
- **State a decision neutrally, with the date it was taken.** A decision no tool or comment can
  hold is one line in [the decisions record](decisions.md), in the commit that makes it.
- **Start a new document from [its template](templates/)**: a folder README, an overview, or a
  glossary entry.

**A comment is a plain sentence saying why**, placed at the line it explains, and only where that
line is not obvious: the constraint, the trap, or the alternative that was rejected. It carries no
citation, no header block and no history. A comment that restates the code is deleted.

## Commit messages

- **The subject is `Scope: what changed`**, in sentence case after the scope, with no trailing
  period. It is declarative, saying what is true once the commit lands ("The list pages share one
  loader"), not an imperative and not Conventional Commits. Two related changes may share a subject
  joined by ", and".
- **The scope is one of** `Frontend`, `Backend`, `Docs`, `Repo`, `Ops` (deployment, images, nginx),
  `CI` (`.github/workflows/`), `Database` (the data or its constraints), `Frontend deps` and
  `Backend deps`. A change reaching several combines them, as in `Backend + Frontend`. Dependabot's
  commit prefixes in `.github/dependabot.yml` follow the same shape, adding `Frontend image` and
  `Backend image` for each Dockerfile's base images.
- **Keep the subject within 72 characters**, where GitHub truncates a title in a list.
- **The body is prose wrapped at about 76 characters**, one paragraph per area, each led by its area.
  It carries what the diff cannot: why the change was made, what was verified and how (with the exit
  code, never the word "passing"), where an earlier assumption was wrong, and the alternative that
  was rejected. No emoji.
- **A pushed commit message is never rewritten.** A false claim in one is corrected in the pull
  request body.

## Pull requests

- **The title has the commit subject's shape.** A pull request with one commit uses that commit's
  subject as it is.
- **The body summarises the branch as a whole and never lists its commits.** A body covering
  several commits opens with one sentence of orientation. `.github/pull_request_template.md` gives
  its sections.
- **The body stands alone.** It links nothing that a reader of the public repository cannot open.

# Writer: this repository

## Installs

- Install with `pnpm install --frozen-lockfile` in `fl_frontend` and
  `uv sync --project fl_backend --dev --frozen` at the root.
- Run git in Git Bash, never PowerShell: the harness checks a PowerShell command's directory, not
  where its git points.

## The targeted set

Your set is the tests of every file you changed and of every module importing one directly, found
through every import form the tree uses: the `@/` alias, a relative path and a dotted Python module.
Add the tests naming a registry that gains a member, and the sweeps, which judge a whole tree rather
than the modules they import:

- where you touched `fl_backend/app`, every test importing `fl_backend/tests/core/app_source.py`,
  which judges every operation of the mounted application;
- where you touched `fl_frontend/src`, every test importing
  `fl_frontend/src/test-support/treeWalk.ts`, which reads the tree's source, directly or through a
  module importing it.

Run them, and the checks of what you touched, with these commands:

- Frontend tests: `pnpm run test:base <files>` in `fl_frontend`, split into several runs where
  Windows refuses the line as too long.
- Backend and script tests: `uv run --project fl_backend --frozen pytest <paths>` from the root. The
  root holds no `pyproject.toml`, so a bare `uv run` there runs no pytest. A path under
  `scripts/tests` runs from Git Bash alone, the one shell whose bash
  `scripts/tests/conftest.py :: pytest_configure` lets run the cases.
- Database cases: that command deselects every case marked `db`, so each test file of your set that
  holds one runs again on its own, `uv run --frozen pytest -m db <file>` from `fl_backend`, with
  `<file>` relative to that folder, as `tests/api/test_roles.py`, whether or not your brief mentions
  the database. A file holds one where it contains `pytest.mark.db`.
- Where you touched `fl_frontend`: `pnpm run typecheck`, `pnpm run lint`, `pnpm run knip` and
  `pnpm run knip:prod`. The typecheck runs `next typegen` first, without which a fresh worktree's
  `tsc` passes a page that breaks Next's route types. The two knip runs fail an export or a file
  your change left unread, which no test reaches.
- Where you touched the backend: from `fl_backend`, `uv run --frozen python -m pyright`,
  `uv run --frozen ruff check app tests` and `uv run --frozen ruff format --check app tests`, as
  `scripts/gate/verify.sh :: scope_backend` runs them.
- Where you touched `scripts`: `uv run --project ../fl_backend --frozen python -m pyright` from
  `scripts`, where pyright finds its configuration, and from the root
  `uv run --project fl_backend --frozen ruff check scripts` and
  `uv run --project fl_backend --frozen ruff format --check scripts`, as
  `scripts/gate/verify.sh :: scope_scripts` runs them.
- Where you changed a shell script, a hook without a suffix included: `./scripts/gate/selfcheck.sh`
  from your worktree's root; it reads the whole tree, so a finding naming a file you do not own is
  someone else's.
- Where you touched a route handler, a metadata file Next builds from code (`sitemap`, `robots`,
  `manifest` or an image such as `icon`) or `nginx/shared/site.conf`:
  `uv run --project fl_backend --frozen python scripts/checks/check_public_routes.py` from the root.
- Where you changed Markdown: `pnpm run lint:md` in `fl_frontend`, and lychee through
  `./scripts/gate/verify.sh --docs` from your worktree's root. Each reads the whole tree, so a
  finding naming a file you do not own is someone else's.

`--docs` is the one scope of `./scripts/gate/verify.sh` you run; the gate's other scopes and its
whole run are the coordinator's.

## Looks, pages and boards

The owner's bar for every surface is a professional, industry-standard look. A brief that designs a
look, builds a page or draws a review board, a page outside the site that shows the owner a
question's options as pictures, holds you to these rules.

- **A look, a layout or an interaction.** Read first the design systems your brief names, among
  Material 3, Apple's Human Interface Guidelines, GitHub Primer, Atlassian, Shopify Polaris, IBM
  Carbon and GOV.UK as fit the component, and put a short quote and a one-line finding from each in
  your report. Build what they agree on, the same way on every surface you own: the site's own pages
  say how to apply a pattern uniformly, not which pattern is right. Decide each detail by that
  standard and the owner's stated taste, and cite the source. A stated preference binds as stated,
  so keep what the owner liked, and never read a complaint about one placement as a wish to remove
  the thing placed. An old ruling or an agent's recommendation is evidence, never the answer. Send
  the coordinator only a fork that the standard and the owner's words leave open, with the systems'
  evidence in its options.
- **A page.** It is done once the coordinator, which did not build it, has raised the stack and
  driven it in a browser at desktop and phone width, recording frames and comparing them with the
  board, and what it found is fixed before the owner's look, since a green gate, a structural read
  and static frames prove nothing of how a page feels. You raise no stack and open no browser. Build
  to what that drive looks for: no layout shift from skeleton to page, a visible hover state and the
  pointer cursor on every interactive element, one option state set in every menu and list box,
  sections and columns on one grid, and dates in one shape. A rule the owner settles on one page
  goes into the kit and every page.
- **A review board.** A board is only for a design decision the owner must see as pictures. For a
  small question, name the page, the element and each option's exact wording to the coordinator, who
  renders each wording into the element with the review-board tool's capture `script`, a snippet run
  after the page loads, and pictures it, the rules below on language and theme binding each picture;
  it looks at each for a label cramped, overflowing, clipped mid-line or invisible and sends the
  pictures to you. Look at each with the Read tool, and send an option one shows at fault, reworded,
  back to the coordinator, who pictures it again before your report is final; the coordinator then
  puts the question to the owner with the pictures. Where your brief asks a board for such a
  question, send those in its place and name the departure in your report. Write a board in English,
  its questions, option names, explanations and controls included, and show the site's German copy
  as it stands, since the owner works in English and judges the copy as a visitor reads it. Draw it
  in the dark theme alone, adding a light frame only where the question is about the light theme and
  says so. It is reviewed on a phone, so it fits 375 px with no horizontal scroll, its controls work
  by touch at 44 px or more with nothing behind hover, and it is reached by a URL, which a localhost
  page is not: you build it with the review-board tool your brief names, never as a page written by
  hand, and message the coordinator where the brief names none; the coordinator publishes it, and
  you publish nothing yourself. Draw no outline or box over a picture, since it hides the edge being
  judged. Every option is one the owner could pick with pride: before you hand the board over, look
  with the Read tool at each option's frames, which the coordinator captures with the review-board
  tool against the running site and saves as image files in the folder your brief names. Where the
  brief names no folder or a frame is missing, an option that exists only in your board's input
  among them, message the coordinator rather than hand the board over without the look. Redraw an
  option where it is cramped, overflowing, clipped mid-line or invisible, and name in your report
  each file you looked at and what it showed. That look is the check of those pictures, and the
  coordinator does not judge them a second time.

## The contract

Where your change moves `fl_backend/openapi.json`, run `pnpm run contract` in `fl_frontend`. It
writes the document and the generated client under `fl_frontend/src/core/generated/`, and both are
committed with the change.

## Commits

A commit message follows `docs/writing.md`, section "Commit messages". Write it with the Write tool
into your scratch folder and commit it with `git commit -F <file>`: the shell tool turns a typed
`\\` into `\`, and cuts off a long command, one of 9 KB among them.

## Traps

- No package is added or moved. `fl_frontend/pnpm-workspace.yaml :: minimumReleaseAge` and
  `fl_backend/pyproject.toml :: exclude-newer` refuse a release younger than their window, and an
  exclusion from either is a workaround the owner must approve. Where the work needs a package,
  message the coordinator.
- The database tier never runs whole, as `pytest -m db` with no path and `pnpm run test:db` run it.
  Each run starts its own containers.
- A check that needs a database shell runs the host's `mongosh` against the published port of the
  database your brief names, as `mongosh "mongodb://127.0.0.1:<port>/?directConnection=true"`.
  Without `directConnection=true` the client follows the replica set's container-internal member
  address and reaches nothing. Never use `docker exec`, which the project's settings refuse; where
  your brief names no database and port, or the command fails, message the coordinator with the
  command and its error.
- No check runs against a deployed environment's database, which reaches real data, unless your
  brief names that exact command.
- Never run `./scripts/ops/local.sh`: its ports 3000 and 27017 are fixed, and the machine holds one
  stack.
- Never run `pnpm run format` or any formatter over a folder, which rewrites files other agents own.
  Format your own files by name, as `.claude/CLAUDE.md` section 6 says.
- A programme's rulings are numbered in its records outside this public repository, so no ruling's
  number goes into a tracked file: code, comment, test name or document. A commit body cites one
  only where your brief gives its number.

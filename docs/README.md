# Documentation

Which document answers which question. Read the first five in order when you start here; look the
rest up when a question needs them.

## Read first, in order

1. **[`README.md`](../README.md)**: what the project is and how it is built.
2. **This page**: where each answer lives.
3. **[`domain.md`](domain.md)**: how the league's data fits together, and what a write is refused.
4. **The overview of the surface you will touch**: [frontend](frontend/overview.md),
   [backend](backend/overview.md) or [operations](ops/overview.md).
5. **[`writing.md`](writing.md)**: how a document, a name, a comment, a commit and a pull request are
   written.

## Look up, do not read through

| Document                                                          | Answers                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| [`glossary.md`](glossary.md)                                      | What a German term means, and its name in the code            |
| [`decisions.md`](decisions.md)                                    | What is deliberately never done                               |
| [`datenschutz.md`](datenschutz.md)                                | The Article 30 record of processing, and the deletion concept |
| [`frontend/copy.md`](frontend/copy.md)                            | How a string a visitor reads is written                       |
| [`logging/overview.md`](logging/overview.md)                      | How to follow one request through the logs                    |
| [`ops/spec.md`](ops/spec.md)                                      | The deployed system's services, routing, headers and gate     |
| [`ops/runbooks.md`](ops/runbooks.md)                              | A procedure to run while operating                            |
| [`scripts/README.md`](../scripts/README.md)                       | What each script and checker does                             |
| [`fl_backend/tests/README.md`](../fl_backend/tests/README.md)     | What each backend test support module provides                |
| [`SECURITY.md`](../SECURITY.md)                                   | Where to report a vulnerability                               |
| [`pull_request_template.md`](../.github/pull_request_template.md) | A pull request body's sections                                |

What is still open on the product, the toolchain and the documentation is a
[GitHub issue](https://github.com/felzab/frankfurtleague/issues), labelled by kind.

## The AI agents' folder

`.claude/` holds the working rules of the AI agents that build this project, and nothing in the
repository depends on it: deleting it leaves every check, CI job and build passing. Outside it, only
these name it:

- `fl_frontend/next.config.ts`'s `agentRules` setting
- the `.claude/` entries of `.gitignore` and `.prettierignore`
- the worktree pattern in `fl_frontend/package.json`'s `format` and `format:check` scripts
- the root `README.md`'s tree line and its section "Who builds it"
- `.github/workflows/ai-tooling.yml`, which tests the agents' own tools
- this section, and [`writing.md`](writing.md)'s opening and commit scopes

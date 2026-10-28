# Documentation

**Folder purpose:** everything written down about this project.

## Folder overview

| Read                               | For                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------- |
| [`glossary.md`](glossary.md)       | The German domain vocabulary, and the pitfall in each term              |
| [`domain.md`](domain.md)           | What depends on what, when a field may be edited, and what is refused   |
| [`datenschutz.md`](datenschutz.md) | The data-protection rulings, held there until each reaches its home     |
| [`frontend/`](frontend/)           | The Next.js app — what it is for, and its contract                      |
| [`backend/`](backend/)             | The FastAPI service — what it is for, and its contract                  |
| [`ops/`](ops/)                     | Building, routing, deploying and running the system                     |
| [`logging/`](logging/)             | Following a request through the logs, and what every `error_code` means |
| [`writing.md`](writing.md)         | How documents, comments, commit messages and pull requests are written  |
| [`templates/`](templates/)         | The template to start each kind of document from                        |

What is still open on the product, the toolchain and the documentation is a
[GitHub issue](https://github.com/felzab/frankfurtleague/issues), labelled by kind.

## Coming back after a while

Read in this order:

1. **[`glossary.md`](glossary.md)** — the vocabulary is load-bearing.
2. **[`domain.md`](domain.md)** — its aggregate boundaries are where the expensive mistakes are.
3. **The three surface overviews** — [frontend](frontend/overview.md), [backend](backend/overview.md),
   [ops](ops/overview.md).
4. **[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §7 and the files it indexes under
   [`.claude/rules/`](../.claude/rules/)** — one line per ratified decision.
5. **[`writing.md`](writing.md)** — how a change and its documents are written.

The specs are reference, not reading. Look things up in them; do not read them through.

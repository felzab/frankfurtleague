# Documentation

**Folder purpose:** everything written down about this project.

## Folder overview

| Read                               | For                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------- |
| [`glossary.md`](glossary.md)       | The German domain vocabulary, and the pitfall in each term             |
| [`domain.md`](domain.md)           | What depends on what, when a field may be edited, and what is refused  |
| [`datenschutz.md`](datenschutz.md) | The data-protection rulings, held there until each reaches its home    |
| [`decisions.md`](decisions.md)     | What was decided and is never undone without a new decision            |
| [`frontend/`](frontend/)           | The Next.js app — what it is for, and how it is organised              |
| [`backend/`](backend/)             | The FastAPI service — what it is for, and how it is organised          |
| [`ops/`](ops/)                     | Building, routing, deploying and running the system                    |
| [`logging/`](logging/)             | Following a request through the logs                                   |
| [`writing.md`](writing.md)         | How documents, comments, commit messages and pull requests are written |
| [`templates/`](templates/)         | The template to start each kind of document from                       |

What is still open on the product, the toolchain and the documentation is a
[GitHub issue](https://github.com/felzab/frankfurtleague/issues), labelled by kind.

## Coming back after a while

Read in this order:

1. **[`glossary.md`](glossary.md)** — the vocabulary is load-bearing.
2. **[`domain.md`](domain.md)** — its aggregate boundaries are where the expensive mistakes are.
3. **The three surface overviews** — [frontend](frontend/overview.md), [backend](backend/overview.md),
   [ops](ops/overview.md).
4. **[`decisions.md`](decisions.md)** — one line per ratified decision.
5. **[`writing.md`](writing.md)** — how a change and its documents are written.

The ops spec and the runbooks are reference, not reading. Look things up in them; do not read them
through.

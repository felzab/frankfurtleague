# Documentation

**Folder purpose:** everything written down about Frankfurt-League.

## Folder overview

| Read                                       | For                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [`glossary.md`](glossary.md)               | The German domain vocabulary, and the pitfall in each term                                  |
| [`domain.md`](domain.md)                   | What depends on what, when a field may be edited, and what is refused                       |
| [`datenschutz.md`](datenschutz.md)         | The data-protection rulings, held there until each reaches its home                         |
| [`frontend/`](frontend/)                   | The Next.js app — what it is for, and its contract                                          |
| [`backend/`](backend/)                     | The FastAPI service — what it is for, and its contract                                      |
| [`ops/`](ops/)                             | Building, routing, deploying and running the system                                         |
| [`logging/`](logging/)                     | Following a request through the logs, and what every `error_code` means                     |
| [`_git/`](_git/)                           | Branching, commits, pull requests, the gate, repository settings                            |
| [`_roadmap/`](_roadmap/)                   | What is open on the product, the toolchain, the gate and the documentation corpus           |
| [`_auditing/`](_auditing/)                 | Running an audit or a remediation programme                                                 |
| `audit/`                                   | **Gitignored.** Working documents; what lives there is listed in [`_auditing/`](_auditing/) |
| [`standard.md`](standard.md)               | Writing or changing any documentation — every rule, one line each                           |
| [`shapes.md`](shapes.md)                   | Starting a spec sheet, an overview, a README or a module header — the shape to copy         |
| [`worked-examples.md`](worked-examples.md) | Applying a documentation rule — real passages, each shown before and after                  |

## Coming back after a while

Read in this order:

1. **[`glossary.md`](glossary.md)** — the vocabulary is load-bearing.
2. **[`domain.md`](domain.md)** — its aggregate boundaries are where the expensive mistakes are.
3. **The three surface overviews** — [frontend](frontend/overview.md), [backend](backend/overview.md),
   [ops](ops/overview.md).
4. **[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §7 and the files it indexes under
   [`.claude/rules/`](../.claude/rules/)** — one line per ratified decision.
5. **[`_git/`](_git/)** — how to ship a change.

The specs are reference, not reading. Look things up in them; do not read them through.

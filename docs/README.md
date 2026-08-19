# Documentation

**Verified against:** `cda2912d`, 2026-08-19\
**Folder purpose:** everything written down about Frankfurt-League — a Next.js frontend, a FastAPI backend, MongoDB, deployed with Docker Compose behind nginx on a single host.

## Folder overview

| Read                                                     | For                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`glossary.md`](glossary.md)                             | The German domain vocabulary, and the pitfall in each term                                  |
| [`domain.md`](domain.md)                                 | What depends on what, when a field may be edited, and what is refused                       |
| [`frontend/overview.md`](frontend/overview.md)           | What the Next.js app is for, and how it is organised                                        |
| [`frontend/spec.md`](frontend/spec.md)                   | Its exact contract — routes, caching, invariants                                            |
| [`backend/overview.md`](backend/overview.md)             | What the FastAPI app is for, and how it is organised                                        |
| [`backend/spec.md`](backend/spec.md)                     | Its exact contract — endpoints, error codes, the test suite                                 |
| [`ops/overview.md`](ops/overview.md)                     | How the system is built, routed and deployed                                                |
| [`ops/spec.md`](ops/spec.md)                             | Compose, nginx, the scripts and every gate scope                                            |
| [`_git/`](_git/)                                         | Branching, commits, pull requests, the gate, repository settings                            |
| [`_git/templates.md`](_git/templates.md)                 | Writing a commit message or a pull request body                                             |
| [`ops/runbooks.md`](ops/runbooks.md)                     | The recurring procedures, and what this repository cannot record about the host             |
| [`logging/README.md`](logging/README.md)                 | Following a request through the logs, and adding an error code                              |
| [`_roadmap/open-items.md`](_roadmap/open-items.md)       | What is planned for the product, ranked, and what is deliberately not                       |
| [`_roadmap/tooling-items.md`](_roadmap/tooling-items.md) | What is planned for the toolchain and the documentation corpus, ranked                      |
| [`_roadmap/closed-items.md`](_roadmap/closed-items.md)   | What happened to an item no longer listed                                                   |
| [`_standard/`](_standard/)                               | Writing or changing any documentation — the rules and the shapes                            |
| [`_auditing/`](_auditing/)                               | Running an audit or a remediation programme                                                 |
| `audit/`                                                 | **Gitignored.** Working documents; what lives there is listed in [`_auditing/`](_auditing/) |

## Coming back after a while

Read in this order. About an hour, and it is the shortest path back to changing things confidently.

1. **[`glossary.md`](glossary.md)** — the German vocabulary is load-bearing and some of it is
   counter-intuitive. Everything else assumes this page.
2. **[`domain.md`](domain.md)** — what the data is, what depends on what, and when each thing may be
   edited. Two of its aggregates are counter-intuitive and both mistakes are expensive.
3. **The three surface overviews** — [frontend](frontend/overview.md), [backend](backend/overview.md),
   [ops](ops/overview.md). What each part is, and why it is shaped that way.
4. **[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §7** — one line per ratified decision. The fastest
   answer to "why is it like this", and the reason you will not re-litigate settled questions.
5. **[`_git/`](_git/)** — how to actually ship a change.

The specs are reference, not reading. Look things up in them; do not read them through.

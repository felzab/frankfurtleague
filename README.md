<div align="center">

<img src="fl_frontend/public/icons/manifest/icon-512.png" alt="Frankfurt-League" width="104" height="104">

# Frankfurt-League

**Die Oberstufenliga der Frankfurter Schulen** — fixtures, results, tables and playoffs for a school
football league, at [frankfurtleague.de](https://frankfurtleague.de).

[![verify](https://github.com/felzab/frankfurtleague/actions/workflows/verify.yml/badge.svg)](https://github.com/felzab/frankfurtleague/actions/workflows/verify.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-motor-47A248?logo=mongodb&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

</div>

---

## About

A public site for a Frankfurt schools' football league. Visitors browse the season plan, results, the
group tables and the playoff bracket; a small number of admins enter results and manage venues and
referees. It is a real, deployed application rather than a demo or a template — one server, one
maintainer, a live audience each season.

## Features

**Public**

- **Season plan** and **match history**, filtered to the selected season
- **Group tables** for every group the season runs, ordered by points then goal difference
- **Playoff bracket**, rendered as a horizontally scrolling round-by-round tree
- **Team pages** with each team's record, and **squad lists** per team
- **Fuzzy match search** across teams, venues, dates and referees, German date spellings included
- German throughout, with the domain vocabulary preserved rather than translated

**Admin**

- Magic-link sign-in, with admin access granted by email allowlist
- **Result entry** that moves the league table, which is computed from the matches rather than stored
- **Venue and referee management**, with renames fanned out into every match that embeds them
- An **action-required view** grouping matches that are missing data or a result

## Stack

| Layer        | What                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| **Frontend** | Next.js 16 (App Router, React 19 Server Components), HeroUI v3, Tailwind v4 |
| **Backend**  | FastAPI, Pydantic v2, Motor (async MongoDB)                                 |
| **Auth**     | Auth.js — magic-link sign-in, admin by email allowlist                      |
| **Deploy**   | Docker Compose behind nginx, on a single host                               |

The app never calls FastAPI from the browser: every application read is a server-side fetch from the
Next.js container, and the backend gates every request on a shared key. That one fact explains most of
the architecture — why all caching lives in the frontend, and why the backend has no user sessions.

## Repository layout

```
fl_frontend/     Next.js app — feature slices under src/features/
fl_backend/      FastAPI app — one package per entity under app/api/
nginx/           reverse proxy config, local and prod
scripts/         verify, publish, deploy, and their self-checks
docs/            the documentation set
```

## Documentation

**[`docs/`](docs/) is the entry point**, and it is thorough — start with
[`docs/README.md`](docs/README.md), which carries a reading path.

|                                        |                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Glossary](docs/glossary.md)           | The domain vocabulary is **German** and load-bearing — `Spiel`, `Spieltag`, `Saison`, `Schiedsrichter`. Read this first                 |
| [Decisions](docs/_decisions/)          | Why the codebase is shaped the way it is, including the alternatives that lost                                                          |
| [Git](docs/_git/)                      | Branching, commits, PRs, the verification gate, and the repository settings that enforce them                                           |
| Per surface                            | [frontend](docs/frontend/overview.md) · [backend](docs/backend/overview.md) · [ops](docs/ops/overview.md) — an overview and a spec each |
| [`docs/ops/spec.md`](docs/ops/spec.md) | Every script, every gate scope, and what each one proves                                                                                |

Several things here look like mistakes and are deliberate — three near-identical match cards, no barrel
files, a `connection()` call that appears to defeat static rendering. Each has an ADR saying why.
**Check [`docs/_decisions/`](docs/_decisions/) before "fixing" something that looks wrong.**

## Contributing

Short-lived topic branches off `main`, one PR each, merged with a merge commit. Commit messages carry
real weight here — they explain _why_ and record what was verified, and they are kept rather than
squashed; [`docs/_git/spec.md`](docs/_git/spec.md) is the convention.

Run the gate before opening a PR, at the scope [`CONTRIBUTING.md`](CONTRIBUTING.md) names. CI runs it too.

Full detail — setup, how to report a bug, and where ideas go: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Status

Actively maintained by one person. There is no public issue triage process and no support commitment.

## Security

Do not open a public issue for a suspected vulnerability. See [`SECURITY.md`](SECURITY.md) for what is
in scope and how to report it privately.

## License

**[Elastic License 2.0](LICENSE)** (`Elastic-2.0`) — source-available, not open source. You may use,
copy, modify and redistribute the code, including commercially. You may **not** offer it to third
parties as a hosted or managed service, and you must keep the copyright notices intact and mark any
modifications.

**The name, the logo and the league's data are not covered by that licence** and are not licensed at
all — see [`NOTICE`](NOTICE). Use of the trademarks is subject to applicable law. To ask for anything
beyond that, get in touch via [frankfurtleague.de/kontakt](https://frankfurtleague.de/kontakt).

## Links

[Website](https://frankfurtleague.de) · [About](https://frankfurtleague.de/about) ·
[The team](https://frankfurtleague.de/team) · [Contact](https://frankfurtleague.de/kontakt)

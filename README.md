<div align="center">

<img src="fl_frontend/public/icons/manifest/icon-512.png" alt="Frankfurt-League" width="104" height="104">

# Frankfurt-League

**Die Oberstufenliga der Frankfurter Schulen** — fixtures, results, tables and playoffs for a school
football league, at [frankfurtleague.de](https://frankfurtleague.de).

[![verify](https://github.com/felixzabb/frankfurtleague/actions/workflows/verify.yml/badge.svg)](https://github.com/felixzabb/frankfurtleague/actions/workflows/verify.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-motor-47A248?logo=mongodb&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

</div>

---

## About

A public site for a Frankfurt schools' football league. Visitors browse the season plan, results, the
group tables and the playoff bracket. A small number of admins enter results and manage venues and
referees.

It is a real, deployed application rather than a demo or a template — one server, one maintainer, a
live audience each season.

## Features

**Public**

- **Season plan** and **match history**, filtered to the selected season
- **Group tables** for all four groups, ordered by points then goal difference
- **Playoff bracket**, rendered as a horizontally scrolling round-by-round tree
- **Team pages** with each team's record, and **squad lists** per team
- **Fuzzy match search** across teams, venues, dates and referees — including dates typed the German
  way, `14.03.`
- German throughout, with the domain vocabulary preserved rather than translated

**Admin**

- Magic-link sign-in, with admin access granted by email allowlist
- **Result entry** that updates both teams' statistics inside one database transaction
- **Venue and referee management**, with renames fanned out into every match that embeds them
- An **action-required view** grouping matches that are missing data or a result

## Stack

| Layer        | What                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| **Frontend** | Next.js 16 (App Router, React 19 Server Components), HeroUI v3, Tailwind v4 |
| **Backend**  | FastAPI, Pydantic v2, Motor (async MongoDB)                                 |
| **Auth**     | Auth.js — magic-link sign-in, admin by email allowlist                      |
| **Deploy**   | Docker Compose behind nginx, on a single host                               |

The browser never talks to FastAPI directly: every application read is a server-side fetch from the
Next.js container. That one fact explains most of the architecture — why all caching lives in the
frontend, and why the backend authenticates with shared API keys rather than user sessions.

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

|                                          |                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Glossary](docs/glossary.md)             | The domain vocabulary is **German** and load-bearing — `Spiel`, `Spieltag`, `Saison`, `Schiedsrichter`. Read this first                 |
| [Decisions](docs/_decisions/)            | 16 ADRs. Why the codebase is shaped the way it is, including the alternatives that lost                                                 |
| [Workflows](docs/workflows.md)           | Branching, commits, PRs, deployment, rollback                                                                                           |
| Per surface                              | [frontend](docs/frontend/overview.md) · [backend](docs/backend/overview.md) · [ops](docs/ops/overview.md) — an overview and a spec each |
| [`scripts/README.md`](scripts/README.md) | The operational manual for every script                                                                                                 |

Several things here look like mistakes and are deliberate — three near-identical match cards, no barrel
files, a `connection()` call that appears to defeat static rendering. Each has an ADR saying why.
**Check [`docs/_decisions/`](docs/_decisions/) before "fixing" something that looks wrong.**

## Contributing

Short-lived topic branches off `main`, one PR each, merged with a merge commit.

Commit messages carry real weight here — they explain _why_ and record what was verified, and they are
kept rather than squashed. [`docs/workflows.md`](docs/workflows.md) shows the convention with real
examples.

Run `./scripts/verify.sh` before opening a PR. CI runs the same script.

## Status

Actively maintained by one person. There is no public issue triage process and no support commitment.

## Security

Do not open a public issue for a suspected vulnerability. Report it privately via
[frankfurtleague.de/kontakt](https://frankfurtleague.de/kontakt).

There is no `SECURITY.md` and no published disclosure policy yet.

## License

**Source-available, not open source.** See [`LICENSE`](LICENSE).

The source is published so it can be read, studied and contributed to. You may fork it to prepare a
contribution and run it locally to test that contribution. You may **not** deploy it, host it, reuse
parts of it in another project, or redistribute it. The name and the logo are not licensed at all.

To ask for anything beyond that, get in touch via
[frankfurtleague.de/kontakt](https://frankfurtleague.de/kontakt).

## Links

[Website](https://frankfurtleague.de) · [About](https://frankfurtleague.de/about) ·
[The team](https://frankfurtleague.de/team) · [Contact](https://frankfurtleague.de/kontakt)

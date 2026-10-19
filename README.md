<div align="center">

<img src="fl_frontend/public/icons/manifest/icon-512.png" alt="Frankfurt League" width="104" height="104">

# Frankfurt League

**Die Oberstufenliga der Frankfurter Schulen** — fixtures, results, tables and playoffs for a school
football league, and everything behind them, from a school's application to a pupil's squad entry,
at [frankfurtleague.de](https://frankfurtleague.de).

[![verify](https://github.com/felzab/frankfurtleague/actions/workflows/verify.yml/badge.svg)](https://github.com/felzab/frankfurtleague/actions/workflows/verify.yml)
![Next.js](https://img.shields.io/github/package-json/dependency-version/felzab/frankfurtleague/next?filename=fl_frontend%2Fpackage.json&label=Next.js&logo=next.js&logoColor=white&color=black)
![React](https://img.shields.io/github/package-json/dependency-version/felzab/frankfurtleague/react?filename=fl_frontend%2Fpackage.json&label=React&logo=react&logoColor=white&color=149eca)
![TypeScript](https://img.shields.io/github/package-json/dependency-version/felzab/frankfurtleague/dev/typescript?filename=fl_frontend%2Fpackage.json&label=TypeScript&logo=typescript&logoColor=white&color=3178c6)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelzab%2Ffrankfurtleague%2Fmain%2Ffl_backend%2Fpyproject.toml&query=%24.project%5B%27requires-python%27%5D&label=Python&logo=python&logoColor=white&color=3776ab)
![MongoDB](https://img.shields.io/badge/MongoDB-pymongo-47A248?logo=mongodb&logoColor=white)

</div>

---

## About

The public site and the whole administration of a Frankfurt schools' football league, German
throughout: a real, deployed application rather than a demo or a template, with a live audience
every season.

## Features

| Who                    | What they can do                                                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visitors**           | Follow the season's `Spielplan` and results; read the `Saisontabelle` of every group, computed from the matches rather than stored; follow the `Finalrunden` bracket; browse every team and its squad list; find any match with a fuzzy `Spielsuche` across teams, venues, dates and referees |
| **Schools**            | Apply to play a season through its public application form (`Bewerbung`) while the season takes applications; each of the school's three contact people confirms their own entry through a mailed link before the league decides                                                              |
| **Contact people**     | Sign in to their team's area (`Bereich`) for each current or coming season they hold a seat in: see who holds the three seats, keep the team's squad (`Kader`) row by row, and admit or decline the pupils who registered for it                                                              |
| **Pupils**             | Register for their team through the team's own link (`Einladung`) while the season takes registrations, confirm with their birthdate and their consent to what is published about them, and once admitted sign in to see their own record and squad entries                                   |
| **Referees**           | Confirm the entry the league made for them through a mailed link, and sign in to see their own record                                                                                                                                                                                         |
| **Everyone signed in** | Sign in with a passkey or a code mailed to them, and manage their account (`Konto`) on one page: passkeys, open sign-ins, every consent the league holds on their records — given or withdrawn — and deleting the account through a mailed confirmation link                                  |
| **Administrators**     | Sign in with a passkey alone, holding a stored grant (`Berechtigung`), and run everything below                                                                                                                                                                                               |

| Administration       | What it covers                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seasons**          | Create a season with its scoring rules and its application and registration windows; draw its whole `Spielplan` in one step, and redraw or undraw it while nothing is recorded; swap two clubs between groups; activate it                                                |
| **Matches**          | Date each `Spieltag`; enter results in the match editor, which moves the table; book a referee and a venue onto each fixture; work down `Handlungsbedarf`, every match still waiting on an entry                                                                          |
| **Clubs and people** | Decide the schools' applications, an acceptance creating the club and entering it into the season; seat each team's contact people for the season, each mailed a confirmation link; mail every team its registration link in one press; keep players, referees and venues |
| **Mail**             | See whether each confirmation and registration mail was delivered, delayed, bounced or suppressed, filed from the mail provider's delivery reports beside the record it was sent about                                                                                    |
| **Access**           | Grant, change or revoke administrator access, every change mailed to everyone who holds it; bar an address from signing up and from the league's mail (`Sperrliste`)                                                                                                      |
| **Privacy and log**  | Erase everything held at an address on request (`Löschung auf Anfrage`); end an address's sign-ins; read the `Änderungsprotokoll` of every recorded write                                                                                                                 |

**A pupil's name reaches the public squad list only where they consented to it**, and a surname only
as an initial; unconfirmed applications and
registrations expire on their own; and a pupil's data is deleted once no season the league keeps
still needs it. Every ruling behind that is in [`docs/datenschutz.md`](docs/datenschutz.md).

## Architecture

**No browser reaches FastAPI for application data.** Every application read is a server-side fetch
from the Next.js container, which makes Next.js the application server as well as the website. That
one fact explains most of the architecture: the caching and its invalidation live in the frontend,
and the backend keeps no user sessions — it admits its one caller on shared API keys in tiers, and
learns who is signed in from a short-lived token the frontend signs. The sign-in store is the single
exception to "every read goes through FastAPI": Better Auth reads its own database directly, which
holds no league data.

## Stack

| Layer        | What                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Frontend** | Next.js (App Router, React Server Components), React, TypeScript, HeroUI, Tailwind CSS, Zod                      |
| **Backend**  | FastAPI, Pydantic, PyMongo's async client                                                                        |
| **Data**     | MongoDB — the league's database behind FastAPI, and a separate sign-in database                                  |
| **Auth**     | Better Auth — passkey or mailed-code sign-in; the administration admits a passkey session alone                  |
| **Deploy**   | Docker Compose behind nginx, on a single host; CI publishes the images and the server pulls them, never building |

The exact versions are the manifests' and the lockfiles': `fl_frontend/package.json`,
`fl_frontend/pnpm-lock.yaml`, `fl_backend/pyproject.toml` and `fl_backend/uv.lock`.

## Quality

Every change reaches `main` through a pull request merged with a merge commit, never squashed: the
commit messages explain _why_ and record what was verified ([`docs/_git/spec.md`](docs/_git/spec.md)).

`./scripts/gate/verify.sh` is the gate. Run with no flags it runs every scope, concurrently, and
[`docs/ops/spec.md`](docs/ops/spec.md#16-the-verification-gate) has what each one runs and needs:

| Scope              | Checks                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `--format`         | Prettier over the whole repository, in check mode                                                     |
| `--docs`           | The documentation gate, which holds `docs/` to its standard and resolves every citation into the code |
| `--backend`        | The lockfile, ruff, pyright, pytest, the test estate and the declared dependencies                    |
| `--frontend`       | The lockfile, tsc, ESLint, knip, the dependency audit and a production `next build`                   |
| `--frontend-units` | The frontend's unit tests                                                                             |
| `--db`             | Both surfaces' database-tier tests, against real MongoDB instances                                    |
| `--ops`            | The workflows, both compose stacks, the nginx configuration, and what the edge logs and sends         |
| `--scripts`        | The gate's own scripts, linted, type-checked and tested                                               |
| `--images`         | Both Docker images, built and probed                                                                  |

CI's `verify` workflow runs the same scopes, one parallel job each, on every pull request and every
push to `main`, and an image is published only from a `main` whose own `verify` run passed.

## Repository layout

```
fl_frontend/     Next.js app — routes under src/app/, feature slices under src/features/
fl_backend/      FastAPI app — one package per slice under app/api/
nginx/           reverse proxy configuration, local and production
scripts/         the gate, its checkers, and the deploy and operations scripts
docs/            the documentation corpus
.github/         CI workflows
.claude/         the rules the development runs under
```

## Documentation

**[`docs/`](docs/) is the entry point** — start with [`docs/README.md`](docs/README.md), which
carries a reading path.

|                                        |                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Glossary](docs/glossary.md)           | The domain vocabulary is **German** and load-bearing — `Spiel`, `Spieltag`, `Saison`, `Kader`, `Bewerbung`. Read this first             |
| [Domain](docs/domain.md)               | What depends on what, when a field may be edited, and what is refused                                                                   |
| [Datenschutz](docs/datenschutz.md)     | The data-protection rulings, and which code performs each                                                                               |
| Per surface                            | [frontend](docs/frontend/overview.md) · [backend](docs/backend/overview.md) · [ops](docs/ops/overview.md) — an overview and a spec each |
| [Git](docs/_git/)                      | Branching, commits, pull requests, the gate, and the repository settings that enforce them                                              |
| [`docs/ops/spec.md`](docs/ops/spec.md) | Every script, every gate scope, and what each one proves                                                                                |

Several things here look like mistakes and are deliberate, each a ratified decision.
**Check [`.claude/CLAUDE.md`](.claude/CLAUDE.md) §7 and the files it indexes under
[`.claude/rules/`](.claude/rules/) before "fixing" something that looks wrong.**

## Maintenance

Frankfurt League is designed, developed and maintained by one person: me,
[@felzab](https://github.com/felzab). I build it with AI coding agents — Anthropic's
[Claude Code](https://claude.com/claude-code) — which write and audit code under my direction. I make
every product and design decision, review the work and merge every change. There is no public issue
triage process and no support commitment.

## Security

Do not open a public issue for a suspected vulnerability — [`SECURITY.md`](SECURITY.md) has the scope
and the private channel.

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
[Organisation](https://frankfurtleague.de/organisation) · [Contact](https://frankfurtleague.de/kontakt)

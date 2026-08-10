# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Report it privately via **[frankfurtleague.de/kontakt](https://frankfurtleague.de/kontakt)**, or by
opening a [private security advisory](https://github.com/felzab/frankfurtleague/security/advisories/new)
on this repository.

Useful things to include, roughly in order of how much they help:

- what an attacker could do with it
- the steps to reproduce it
- the affected URL, endpoint or file
- whether it is already public anywhere

You will get a reply. This project is maintained by one person alongside other work, so please allow a
few days before following up.

## What is in scope

The application and infrastructure in this repository: the Next.js frontend, the FastAPI backend,
the nginx configuration and the deployment scripts.

Particularly welcome:

- anything that reaches admin functionality without an admin session
- anything that exposes data the public site does not already show
- injection of any kind, or a way to get markup or scripts rendered
- a way to reach the backend API without a valid key, or to reach an internal-only route from outside

## What is not in scope

- **Findings from an automated scanner with no demonstrated impact.** A header grade or a version
  fingerprint is not a vulnerability on its own.
- **Denial of service**, volumetric or otherwise. This is a small site on one host; please do not test
  its limits.
- **Social engineering** of the maintainer or of anyone involved in the league.
- **Anything requiring physical access** to the server, or a compromised admin device.
- **`'unsafe-inline'` in the Content-Security-Policy.** This is a known, deliberate trade-off with a
  documented compensating control — see
  [ADR-0011](docs/_decisions/0011-single-enforced-csp.md). A demonstrated injection that the policy
  fails to stop is very much in scope; the directive by itself is not.

## Please do not

Test against **frankfurtleague.de**. Run it locally instead — `./scripts/local.sh` builds and serves
the production image on your own machine, behind the same nginx configuration, which is enough to
demonstrate almost anything.

The site carries real league data that people rely on during a season.

## Scope of this policy

There is no bug bounty and no reward. This is a school league project maintained by one person.

There are no supported older versions: only what is currently deployed is maintained, and fixes go
out with the next deploy.

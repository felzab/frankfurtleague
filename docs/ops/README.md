# Ops

**Folder purpose:** `docker-compose*.yml`, `nginx/`, `scripts/` and both Dockerfiles — how the system is built, routed, deployed and run.

## Folder overview

| Read                         | For                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| [`overview.md`](overview.md) | The topology, and the constraints it assumes                                                   |
| [`spec.md`](spec.md)         | The contract — services, mounts, nginx routing, security headers, the scripts, the gate scopes |
| [`runbooks.md`](runbooks.md) | A procedure run rather than read, and the operational facts no file here states                |

## Read next

- [`../_git/spec.md`](../_git/spec.md) — the pipeline a change travels before any of this runs
- [`../logging/spec.md`](../logging/spec.md) — what each service writes, and how one request is followed across them

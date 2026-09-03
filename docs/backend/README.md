# Backend

**Folder purpose:** the `fl_backend/` FastAPI service over MongoDB.

## Folder overview

| Read                         | For                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| [`overview.md`](overview.md) | What the service is for, and how its slices are organised                                        |
| [`spec.md`](spec.md)         | The contract — endpoints and their guards, the match write path, error codes, environment, tests |

## Read next

- [`../domain.md`](../domain.md) — the model these routes implement, and what a write owes its neighbours
- [`../frontend/spec.md`](../frontend/spec.md) — the caller's side, and where the caching for these reads lives
- [`../logging/error-codes.md`](../logging/error-codes.md) — every `error_code` on the wire, and the response shape

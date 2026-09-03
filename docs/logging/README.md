# Logging

**Folder purpose:** how a request is followed across nginx, the frontend and the backend — what a
log line is on each surface, what an error code means, and how to get from a symptom to the right
lines.

## Folder overview

| Read                               | For                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| [`spec.md`](spec.md)               | The correlation id, the stream contract, the invariants, and a symptom's remedy |
| [`error-codes.md`](error-codes.md) | Every `error_code` either service emits, and the response shape                 |

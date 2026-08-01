/**
 * API · Auth.js route handlers
 *
 * The only Next route handler reachable from the internet: nginx sends `/api` to FastAPI and carves
 * out `/api/auth` for this one. Everything under it — sign-in, callback, session — is Auth.js's own.
 *
 * The configuration lives in `core/auth.ts`. This file is deliberately nothing but a re-export; adding
 * logic here would put it on an unauthenticated public path.
 */

import { handlers } from "@/core/auth";

export const { GET, POST } = handlers;

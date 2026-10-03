import { registerDoubles } from "@/core/exportingModule.ts";

import { NEXT_HEADERS_DOUBLE } from "./actionDoubles.ts";

import type { Doubles } from "@/core/exportingModule.ts";

/**
 * The packages a public route handler reaches that this process cannot load, under the modules and
 * packages a suite doubles itself. Registered before the suite's `await import` of the route, as
 * `fl_frontend/src/shared/testing/undoRoutes.ts :: doubleRouteRequest` is.
 */
export function doublePublicRouteRequest({ modules = {}, specifiers = {} }: Doubles = {}): void {
  registerDoubles({
    modules: modules,
    specifiers: {
      // A response handed back as its body and status, which a case reads without parsing one.
      "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => ({ body, status: init?.status ?? 200 }) } },
      "next/headers": NEXT_HEADERS_DOUBLE,
      ...specifiers,
    },
  });
}

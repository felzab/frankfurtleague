import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/core/auth/library";
import { runWithIncomingTrace } from "@/core/traceScope";

const handlers = toNextJsHandler(auth);

// Under the edge's trace: the library's hooks call the backend, the passkey enrolment's gate read and
// `fl_frontend/src/core/auth/minting.ts :: refuseUnadmitted` at a session's creation, and nothing else opens this
// request's scope, so a call outside it is filed under a trace no edge line carries.
export const GET = (request: Request): Promise<Response> => runWithIncomingTrace(() => handlers.GET(request));
export const POST = (request: Request): Promise<Response> => runWithIncomingTrace(() => handlers.POST(request));

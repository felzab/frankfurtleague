import "server-only";

import { postBerechtigungenAbgleich } from "./mutations";

/**
 * One comparison pass, for the hourly scheduler (`fl_frontend/src/instrumentation-node.ts :: armScheduler`): the backend
 * finds every change made to the grants in the database and owes its notice in the Postausgang, which the pass's drain
 * sends. A change made through the application owes its own notice in its own write. A failure rejects, for the
 * heartbeat to name.
 */
export async function runBerechtigungenAbgleich(): Promise<void> {
  await postBerechtigungenAbgleich();
}

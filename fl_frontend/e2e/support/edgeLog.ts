/**
 * E2E · the address the stack's edge judged each request by, read where it writes its access log.
 *
 * nginx writes one JSON line per request (`nginx/shared/http.conf :: fl_json`), `client` being the
 * address its rate zones key on once realip has run, and docker-compose.e2e.yml mounts the log at
 * `.tmp-e2e/nginx-log` in the checkout. A journey names its own address in `CF-Connecting-IP`, which
 * the edge takes only from the one source `nginx/e2e/e2e.conf` trusts; from any other, `client` is
 * that source, and every journey then spends one budget of every limit, the sign-in's among them.
 */
import { open, stat } from "node:fs/promises";
import path from "node:path";

/** In the checkout's root, three levels above `fl_frontend/e2e/support/`, as the mail sink is. */
const ACCESS_LOG = path.resolve(__dirname, "..", "..", "..", ".tmp-e2e", "nginx-log", "access.log");

/** RFC 5737's documentation range, from which `./journey.ts` hands every journey its address. */
const VISITOR_RANGE = /^198\.51\.100\.\d{1,3}$/;

/** Where the log ends now, so a reading later takes only the lines written since. */
export async function accessLogEnd(): Promise<number> {
  return (await stat(ACCESS_LOG)).size;
}

/**
 * Throws unless the edge logged at least one request since `from` under `visitor`, and none under an
 * address no journey holds. nginx declares no healthcheck, so every line comes in through the
 * published port. A line naming another journey's address is a request that journey left in flight.
 */
export async function expectEdgeSawVisitor(visitor: string, from: number): Promise<void> {
  const clients = await clientsSince(from);

  const strangers = [...new Set(clients.filter((client) => !VISITOR_RANGE.test(client)))];
  if (strangers.length > 0)
    throw new Error(
      `the e2e edge judged requests by ${strangers.join(", ")} rather than by the journeys' own addresses: ` +
        "it trusts CF-Connecting-IP from the one source nginx/e2e/e2e.conf names, and these arrived from another, " +
        `so every journey shares their limits (${ACCESS_LOG})`,
    );

  if (!clients.includes(visitor)) throw new Error(`the e2e edge logged no request under this journey's address ${visitor} (${ACCESS_LOG})`);
}

async function clientsSince(from: number): Promise<string[]> {
  const log = await open(ACCESS_LOG, "r");
  try {
    const { size } = await log.stat();
    const appended = Buffer.alloc(Math.max(0, size - from));
    await log.read(appended, 0, appended.length, from);
    // nginx writes each line with a write of its own, its `access_log` naming no `buffer`, so the text
    // ends in a newline and the empty piece after it is dropped. A line caught half-written would be
    // dropped too and read by no later reading, each starting where the log ended as its journey began.
    const lines = appended.toString("utf8").split("\n").slice(0, -1);
    return lines.map((line) => clientOf(line));
  } finally {
    await log.close();
  }
}

function clientOf(line: string): string {
  const entry: unknown = JSON.parse(line);
  const client: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "client") : undefined;
  if (typeof client !== "string") throw new Error(`an access-log line names no client: ${line}`);
  return client;
}

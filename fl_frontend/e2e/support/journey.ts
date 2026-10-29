/**
 * E2E · the `test` every journey imports: Playwright's own, with the options a project sets and the
 * address each journey visits from.
 *
 * Options rather than constants per file, so one journey runs under both projects as each project's
 * own people (https://playwright.dev/docs/test-parameterize#parameterized-projects). Each is a
 * record of `scripts/ops/seed/seed.js`, and no two projects share one: a passkey or a code one
 * project made is never the other's to find.
 */
import { once } from "node:events";
import { Agent, createServer, request } from "node:http";
import { connect } from "node:net";
import { pipeline } from "node:stream";

import { test as base } from "@playwright/test";

import { accessLogEnd, expectEdgeSawVisitor } from "./edgeLog";

import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { Socket } from "node:net";

export type JourneyOptions = {
  /** An administrator's grant. */
  administrator: string;
  /** A referee's address, which admits a sign-in and grants no Verwaltung. */
  person: string;
};

type JourneyFixtures = {
  /** The address this journey visits from, which the stack's edge reads as the visitor's. */
  visitor: string;
};

/**
 * The addresses one worker hands out, each to one journey. A worker replacing a failed one has the
 * next `workerIndex` and so the next block, never an address a journey before it spent.
 */
const ADDRESSES_PER_WORKER = 16;

/** The journeys this worker has started. */
let started = 0;

/** The header Cloudflare names the visitor in, and the one `nginx/e2e/e2e.conf` trusts from the host. */
const VISITOR_HEADER = "cf-connecting-ip";

/**
 * What this proxy consumes rather than forwards, beside any header `Connection` names: `Connection`
 * itself and the five fields RFC 9110 section 7.6.1 lists; `Proxy-Authorization`, credentials meant for a
 * proxy (section 11.7.2), which no target of this one is, and `Proxy-Authenticate`, a challenge meant for
 * the next client on the response chain (section 11.7.1), which is this proxy and not the browser; and
 * `Trailer`, which would announce trailer fields this proxy never passes on.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "proxy-connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** `net.connect` takes an IPv6 host without the brackets a URL spells it in. */
const hostOf = (target: URL): string => target.hostname.replace(/^\[(.*)\]$/, "$1");

function endToEnd(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = new Set((headers.connection ?? "").split(",").map((token) => token.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name) && !named.has(name)));
}

/**
 * A piped stream ended early: the browser left mid-request, as an outgoing document does when a
 * navigation commits, or the stack dropped an answer it had begun. `pipeline` has destroyed every
 * stream of the pair, which ends the browser's connection as a direct one would have ended, so nothing
 * more is answered. A target the proxy never reached is answered apart, by `unanswered`.
 */
function endedEarly(): void {
  // Nothing to answer; see above.
}

/**
 * The request to the target failed. No stream of the browser's was piped from it, so nothing else ends
 * the browser's request, which would wait out the journey's timeout and name no cause: before any answer
 * it is answered 502, as a gateway answers for a target it cannot reach, and once an answer has begun,
 * its connection ends, as a direct one would.
 */
function unanswered(outgoing: ServerResponse): void {
  if (outgoing.headersSent || outgoing.destroyed) outgoing.destroy();
  else outgoing.writeHead(502).end();
}

/**
 * The forward proxy one journey's browser context reaches the network through, standing where
 * Cloudflare stands in production: it names `visitor` on every request to the stack's `origin`, and
 * passes every other request on as it came. It listens on loopback alone, on a port the system picks.
 */
async function startVisitorProxy(origin: string, visitor: string): Promise<{ server: string; close: () => Promise<void> }> {
  // Its own pool to the stack, so the journey's teardown ends those connections with the rest.
  const agent = new Agent({ keepAlive: true });
  // Sockets a CONNECT takes off the HTTP server, which `closeAllConnections` no longer sees.
  const detached = new Set<Socket>();
  const detach = (socket: Socket): void => {
    detached.add(socket);
    socket.once("close", () => detached.delete(socket));
  };

  const server = createServer((incoming, outgoing) => {
    // A request to a proxy names its target in absolute form.
    const target = URL.parse(incoming.url ?? "");
    if (target === null) {
      outgoing.writeHead(400).end();
      return;
    }
    // A header the browser sent of its own never names the visitor: Cloudflare overwrites it too.
    const { [VISITOR_HEADER]: _sent, ...headers } = endToEnd(incoming.headers);
    if (target.origin === origin) headers[VISITOR_HEADER] = visitor;
    const upstream = request(target, { method: incoming.method, headers, agent }, (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.statusMessage, endToEnd(answer.headers));
      pipeline(answer, outgoing, endedEarly);
    });
    // The request ends with the browser's, so no answer arrives for a response already destroyed.
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) upstream.destroy();
    });
    upstream.on("error", () => unanswered(outgoing));
    pipeline(incoming, upstream, endedEarly);
  });

  // Every tunnel passes untouched: the sign-in's bot check loads from Cloudflare's own over TLS. One to
  // the stack would reach its edge unnamed, which the edge check reports.
  server.on("connect", (incoming: IncomingMessage, socket: Socket, head: Buffer) => {
    detach(socket);
    const target = URL.parse(`http://${incoming.url ?? ""}`);
    if (target === null) {
      socket.destroy();
      return;
    }
    const tunnel = connect(Number(target.port || "443"), hostOf(target), () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      tunnel.write(head);
      pipeline(socket, tunnel, socket, endedEarly);
    });
    tunnel.once("error", () => socket.destroy());
    socket.once("error", () => tunnel.destroy());
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error(`the visitor's proxy listens on no port: ${String(address)}`);

  return {
    server: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      for (const socket of detached) socket.destroy();
      agent.destroy();
      await closed;
    },
  };
}

export const test = base.extend<JourneyFixtures & JourneyOptions>({
  // Empty until a project sets them, which `fl_frontend/playwright.config.ts` does for each.
  administrator: ["", { option: true }],
  person: ["", { option: true }],

  // Each journey is one visitor, as each person on the site is: the edge's rate limits are per visitor,
  // and every journey shares one address with the others unless it names its own
  // (`nginx/e2e/e2e.conf`). Per journey rather than per project, so no journey spends another's
  // budget. RFC 5737's documentation range, which no real visitor holds.
  // `provide` is the fixture's `use`, named apart from React's hook, which a lint rule reads it as.
  visitor: [
    async ({}, provide, testInfo) => {
      if (started === ADDRESSES_PER_WORKER)
        throw new Error(`a worker has ${String(ADDRESSES_PER_WORKER)} visitor addresses, and every one is spent`);
      const address = `198.51.100.${String(1 + ((testInfo.workerIndex * ADDRESSES_PER_WORKER + started) % 254))}`;
      started += 1;

      const logged = await accessLogEnd();
      await provide(address);
      // That the edge took the address is what makes each journey a visitor of its own; where it did not, a
      // journey's sign-in meets another's spent budget as a 429 that names nothing of the cause. Read once
      // the browser context and the proxy beneath it have closed, so every request the journey sent is in.
      await expectEdgeSawVisitor(address, logged);
    },
    { auto: true },
  ],

  // The address goes on where a request leaves the browser for the network, as Cloudflare adds it on the
  // way in. Neither `context.route` nor `extraHTTPHeaders` covers every request: a document a navigation
  // replaces still sends while the next commits, and Chromium sends those past both, with the browser's
  // own user agent (https://github.com/microsoft/playwright/issues/43278). `extraHTTPHeaders` would also
  // carry the header to challenges.cloudflare.com, which answers a request naming its own header with
  // 403, and the sign-in's bot check never loads. A per-context proxy (https://playwright.dev/docs/network#http-proxy)
  // takes every request the context sends, to loopback too: Playwright lifts Chromium's loopback bypass for
  // it, and WebKit sends loopback through it as it is. Built on the journey's address, so the browser
  // context, which is built on this, closes before it, and it before the edge is read.
  proxy: async ({ visitor, baseURL }, provide) => {
    const proxy = await startVisitorProxy(new URL(String(baseURL)).origin, visitor);
    try {
      await provide({ server: proxy.server });
    } finally {
      await proxy.close();
    }
  },
});

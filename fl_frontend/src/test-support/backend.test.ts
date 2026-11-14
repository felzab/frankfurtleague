// The helpers' own guarantee, which every suite answering the network relies on and none tests: a request no case
// answered fails the case that sent it, nothing leaves this machine, and nothing is charged to the wrong case.
// A fault's case is declared `it.fails`, so it is red where the fault no longer fails it; the case after it reads the
// failure's message, which names the request and where it was sent.
import { setTimeout as wallClock } from "node:timers/promises";

import { BACKEND_ORIGIN, networkFailure, serveBackend, serveHost } from "@/test-support/backend.ts";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

/** The backend's own address for `path`, as the real client spells one. */
const endpoint = (path: string): string => `${BACKEND_ORIGIN}/api/v0${path}`;

/** A host that cannot resolve (RFC 2606's `.invalid`): a request sent for real fails on its name, never on a server. */
const NOWHERE = "https://nowhere.invalid";

/** Each case's failure messages, read once every hook of the case, the setup file's last among them, has run. */
const failures = new Map<string, string>();
afterEach(({ task, onTestFinished: finished }) => {
  finished(() => {
    failures.set(task.name, (task.result?.errors ?? []).map(({ message }) => String(message)).join("\n"));
  });
});

/** A case `body` the network must fail, and the case after it, which reads the failure for `named`. */
function failsNaming(name: string, named: RegExp, body: () => Promise<void> | void): void {
  it.fails(name, body);
  it(`${name}: the failure names it`, () => {
    expect(failures.get(name)).toMatch(named);
  });
}

/** The message Node's own `fetch` rejects a network failure with, a `TypeError`: what the answering one must match. */
const PLATFORM_FETCH_FAILED = "fetch failed";

/** How many answers to `/twin` have run to their end. */
let twinsAnswered = 0;
/** How many answers to `/twin` have begun. */
let twinsBegun = 0;

const backend = serveBackend(async ({ path }) => {
  if (path === "/answered") return { answered: true };
  if (path === "/fails") return networkFailure();
  if (path === "/slow") {
    await wallClock(200);
    return { slow: true };
  }
  if (path === "/late") {
    await wallClock(50);
    return undefined;
  }
  if (path === "/twin") {
    // The second of two alike is held past the first, so a wait keyed by the request's spelling ends early.
    twinsBegun += 1;
    if (twinsBegun === 2) await wallClock(100);
    twinsAnswered += 1;
    return { twin: true };
  }
  if (path === "/throws") throw new Error("the answer broke");

  return undefined;
});

/** Every request the file's mail provider took, served for every case. */
const mailed = serveHost("https://mail.example", () => ({ id: "mail" }));

// Both sent while the file loads, before any hook has run.
void fetch(endpoint("/unanswered-at-load")).catch(() => undefined);
const answeredAtLoad = fetch(endpoint("/answered")).then((response) => response.json() as Promise<unknown>);

describe("a request sent while the file loads", () => {
  failsNaming(
    "fails the first case where nothing answered it",
    /nothing answered GET \/unanswered-at-load \(sent before the first case\)/,
    () => {
      // Its body is never reached: the fault fails the case before it.
    },
  );

  it("is answered, the network served before the file's own code", async () => {
    await expect(answeredAtLoad).resolves.toStrictEqual({ answered: true });
  });
});

// Ahead of every case calling `vi.unstubAllGlobals()`, which forgets every original Vitest recorded before it.
describe("a suite replacing `fetch` itself", () => {
  it("keeps its replacement, which the network never meets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("its own"));
    try {
      await expect(fetch(`${NOWHERE}/verify`).then((response) => response.text())).resolves.toBe("its own");
    } finally {
      vi.restoreAllMocks();
    }
  });

  failsNaming("gets the answering fetch back once it unstubs its own", /no case serves GET https:\/\/nowhere\.invalid\/verify/, async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("its own")));
    vi.unstubAllGlobals();
    // Answered by the platform's fetch, this request would fail on the name rather than as a fault.
    await fetch(`${NOWHERE}/verify`).catch(() => undefined);
  });
});

describe("a request no case answered", () => {
  failsNaming("fails the case that sent it", /nothing answered GET \/unanswered \(sent in "fails the case that sent it"\)/, async () => {
    // Swallowed as `postClientError` swallows its own: the case fails all the same.
    await fetch(endpoint("/unanswered")).catch(() => undefined);
  });

  failsNaming("fails the case that sent it after the case's body ended", /nothing answered GET \/late \(sent in "fails the case/, () => {
    // Never awaited: answered 50 ms after the body returned, and still charged to this case.
    void fetch(endpoint("/late")).catch(() => undefined);
  });

  failsNaming("fails the case where the answer throws", /the answer to GET \/throws threw: Error: the answer broke/, async () => {
    await fetch(endpoint("/throws")).catch(() => undefined);
  });

  it("sent after a case ended, is judged before the next case begins", () => {
    onTestFinished(() => {
      void fetch(endpoint("/after-the-end")).catch(() => undefined);
    });
  });
  failsNaming(
    "fails the next case, naming the case it followed",
    /nothing answered GET \/after-the-end \(sent after "sent after a case ended, is judged before the next case begins" ended\)/,
    () => undefined,
  );
});

describe("a request in flight", () => {
  it("is awaited by `answered`, two alike in flight at once being two", async () => {
    twinsBegun = 0;
    twinsAnswered = 0;
    const both = Promise.all([fetch(endpoint("/twin")), fetch(endpoint("/twin"))]);

    await backend.answered();

    expect(twinsAnswered, "`answered` returned while the second of two alike was still open").toBe(2);
    await both;
  });

  it("rejects with its signal's reason once the signal aborts, as the platform's fetch does", async () => {
    const reason = new DOMException("the deadline passed", "TimeoutError");
    const controller = new AbortController();
    const asked = fetch(endpoint("/slow"), { signal: controller.signal });
    controller.abort(reason);

    await expect(asked).rejects.toBe(reason);
    await expect(fetch(endpoint("/answered"), { signal: controller.signal })).rejects.toBe(reason);
  });
});

describe("an answer of a network failure", () => {
  it("rejects as the platform's fetch rejects a network failure", async () => {
    const met = await fetch(endpoint("/fails")).then(
      () => "answered",
      (error: unknown) => (error instanceof TypeError ? error.message : String(error)),
    );

    expect(met).toBe(PLATFORM_FETCH_FAILED);
  });
});

/** What the request to `NOWHERE` met: a status, or the failure's message where it met none. */
let nowhereMet: number | string = "not sent";

describe("a request to another host", () => {
  failsNaming("fails the case that sent it", /no case serves GET https:\/\/nowhere\.invalid\/verify \(sent in/, async () => {
    nowhereMet = await fetch(`${NOWHERE}/verify`).then(
      ({ status }) => status,
      (error: unknown) => (error instanceof Error ? `${error.message}: ${String((error.cause as Error | undefined)?.message)}` : String(error)),
    );
  });

  it("is failed on the network without being sent", () => {
    // Sent, the request would fail on the name `.invalid` never resolves, which names the host's lookup instead.
    expect(nowhereMet).toBe("fetch failed: the network failed GET https://nowhere.invalid/verify");
  });

  failsNaming(
    "fails the case, at the address jsdom's page resolves a relative one against",
    /no case serves POST http:\/\/localhost\/api\/client-error/,
    async () => {
      // As jsdom's page holds `http://localhost/`, where `postClientError` posts its report.
      vi.stubGlobal("location", new URL("http://localhost/"));
      try {
        await fetch("/api/client-error", { method: "POST" }).catch(() => undefined);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("is refused where no page is open to resolve a relative address, as Node refuses it", async () => {
    await expect(fetch("/api/client-error")).rejects.toThrow(TypeError);
  });

  it("is answered where the file serves its host, and recorded", async () => {
    const answer = await fetch("https://mail.example/emails", { method: "POST", body: "{}" }).then(
      (response) => response.json() as Promise<unknown>,
    );

    expect(answer).toStrictEqual({ id: "mail" });
    expect(mailed.map(({ method, url, body }) => [method, url.href, body])).toStrictEqual([["POST", "https://mail.example/emails", {}]]);
  });

  // Right after a case the file's host answered: its record holds that case's request unless emptied before this one.
  it("begins each case with the file's host record empty, as `sent` is", () => {
    expect(mailed).toStrictEqual([]);
  });

  it("is answered where the case serves its host, and recorded", async () => {
    const verified = serveHost(NOWHERE, ({ body }) => ({ success: body === "token" }));

    const answer = await fetch(`${NOWHERE}/verify`, { method: "POST", body: "token" }).then((response) => response.json() as Promise<unknown>);

    expect(answer).toStrictEqual({ success: true });
    expect(verified.map(({ method, url }) => [method, url.href])).toStrictEqual([["POST", `${NOWHERE}/verify`]]);
  });

  failsNaming("is served for its case alone", /no case serves GET https:\/\/nowhere\.invalid\/verify/, async () => {
    await fetch(`${NOWHERE}/verify`).catch(() => undefined);
  });
});

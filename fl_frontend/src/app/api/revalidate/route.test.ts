import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { documentsWrittenByAsync } from "@/core/stdoutCapture.ts";

const SYSTEM_KEY = "s".repeat(64);

/** Each tag the route handed Next, with the profile it handed it under. */
const dropped: [string, unknown][] = [];

registerDoubles({
  modules: {
    "core/config.ts": {
      frontend_config: { API_URL: "http://backend:8000", API_VERSION: 0, LOG_FORMAT: "json", LOG_LEVEL: "INFO" },
      internalApiKeyBase: () => "b".repeat(64),
      internalApiKeySystem: () => SYSTEM_KEY,
      internalApiKeyAdmin: () => "a".repeat(64),
    },
  },
  specifiers: {
    "next/cache": { revalidateTag: (tag: string, profile: unknown) => void dropped.push([tag, profile]) },
    "next/headers": { headers: () => Promise.resolve(new Headers()) },
  },
});

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const { revalidateOverLoopback } = await import("@/core/revalidation.ts");

/** The address Next answers this file at, off its place in the tree. */
const ROUTE_PATH = `/${path
  .relative(path.resolve(import.meta.dirname, "..", ".."), import.meta.dirname)
  .split(path.sep)
  .join("/")}`;

function aCall({ authorization = `Bearer ${SYSTEM_KEY}`, body = JSON.stringify({ tags: ["spieler"] }) } = {}) {
  return new NextRequest(`http://127.0.0.1:3000${ROUTE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization === "" ? {} : { authorization: authorization }) },
    body: body,
  });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  dropped.length = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/revalidate", () => {
  it("drops every tag named, so the next request misses rather than being served the deleted entry once more", async () => {
    const tags = ["saisons", "spiele", "spieler", "spieltage", "teams"];
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(aCall({ body: JSON.stringify({ tags: tags }) }))).status;
    });

    assert.equal(status, 204);
    assert.deepEqual(
      written.map(({ level, message, tags: named }) => ({ level, message, tags: named })),
      [{ level: "INFO", message: "cache.revalidated", tags: tags }],
    );
    assert.deepEqual(dropped, [
      ["saisons", { expire: 0 }],
      ["spiele", { expire: 0 }],
      ["spieler", { expire: 0 }],
      ["spieltage", { expire: 0 }],
      ["teams", { expire: 0 }],
    ]);
  });

  /* Each with a body the route would refuse, so a key judged after the body answers 422 and fails the case. */
  const NOT_THE_KEY = [
    ["no header", ""],
    ["another key", `Bearer ${"x".repeat(64)}`],
    ["the key without its scheme", SYSTEM_KEY],
    ["the key with a character more", `Bearer ${SYSTEM_KEY}s`],
    ["the key's first half", `Bearer ${SYSTEM_KEY.slice(0, 32)}`],
  ] as const;

  for (const [what, authorization] of NOT_THE_KEY) {
    it(`refuses ${what} before reading the body, drops nothing, and names no value`, async () => {
      let status = 0;
      const written = await documentsWrittenByAsync(async () => {
        status = (await POST(aCall({ authorization: authorization, body: JSON.stringify({ tags: ["system"] }) }))).status;
      });

      assert.equal(status, 401);
      assert.deepEqual(dropped, []);
      assert.deepEqual(
        written.map(({ level, message, error_code, field }) => ({ level, message, error_code, field })),
        [{ level: "WARNING", message: "cache.revalidation_refused", error_code: "FE-CACHE-001", field: "authorization" }],
      );
      assert.ok(!JSON.stringify(written).includes("s".repeat(32)), "a refusal's line carries the key it was handed");
    });
  }

  /* A caller holding the key still names nothing beyond the list: `system`, a granular tag and any other string alike. */
  const OFF_THE_LIST = [
    ["a tag off the list", JSON.stringify({ tags: ["spieler", "system"] })],
    ["a granular tag", JSON.stringify({ tags: ["spiele:saison_id:2526"] })],
    ["no tag at all", JSON.stringify({ tags: [] })],
    ["a field beside the list", JSON.stringify({ tags: ["spieler"], profile: "max" })],
    ["a body that is no JSON", "tags=spieler"],
  ] as const;

  for (const [what, body] of OFF_THE_LIST) {
    it(`refuses ${what} from a caller holding the key, dropping nothing`, async () => {
      let status = 0;
      const written = await documentsWrittenByAsync(async () => {
        status = (await POST(aCall({ body: body }))).status;
      });

      assert.equal(status, 422);
      assert.deepEqual(dropped, []);
      assert.deepEqual(
        written.map(({ message, error_code, field }) => ({ message, error_code, field })),
        [{ message: "cache.revalidation_refused", error_code: "FE-CACHE-001", field: "tags" }],
      );
    });
  }
});

describe("the loopback call a timer makes", () => {
  /* The two halves of one mechanism held to each other: a path, a key or a body shape moved on one side alone drops nothing. */
  it("is answered by this route, which drops what it names", async () => {
    const sent: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(input));
      return POST(new NextRequest(String(input), init as ConstructorParameters<typeof NextRequest>[1]));
    }) as typeof fetch;

    const written = await documentsWrittenByAsync(() => revalidateOverLoopback(["spieler"]));

    assert.deepEqual(
      sent.map((url) => new URL(url).pathname),
      [ROUTE_PATH],
    );
    assert.deepEqual(dropped, [["spieler", { expire: 0 }]]);
    assert.deepEqual(
      written.filter(({ level }) => level !== "INFO"),
      [],
    );
  });

  /* A drop that failed is a cached page serving a deleted pupil for up to a week, so it is a line rather than silence. */
  const FAILED = [
    ["a refusal", () => Promise.resolve(new Response(null, { status: 401 })), { status: 401 }],
    ["a connection that broke", () => Promise.reject(new TypeError("fetch failed")), { name: "TypeError" }],
  ] as const;

  for (const [what, answer, named] of FAILED) {
    it(`settles ${what} into one error line naming the tags`, async () => {
      globalThis.fetch = answer as unknown as typeof fetch;

      const written = await documentsWrittenByAsync(() => revalidateOverLoopback(["spieler"]));

      assert.deepEqual(
        written.map(({ level, message, error_code, tags, status, name }) => ({ level, message, error_code, tags, status, name })),
        [
          {
            level: "ERROR",
            message: "cache.revalidation_failed",
            error_code: "FE-CACHE-001",
            tags: ["spieler"],
            status: undefined,
            name: undefined,
            ...named,
          },
        ],
      );
    });
  }
});

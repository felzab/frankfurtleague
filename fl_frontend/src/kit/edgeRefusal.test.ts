import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { EDGE_REFUSAL_BODY } from "./edgeRefusal";

/* Source text rather than a served answer: `nginx/edge_test.sh` serves the file and grades the body
   against this same line, so the two halves meet at it. */
it("expects the very sentence the edge returns, in ASCII alone", () => {
  const site = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "nginx", "shared", "site.conf"), "utf8");
  const returned = [...site.matchAll(/^\s*return 429 "(.*)";$/gm)].map((match) => match[1]);

  expect(returned).toStrictEqual([EDGE_REFUSAL_BODY]);
  expect(EDGE_REFUSAL_BODY).toMatch(/^[ -~]+$/);
});

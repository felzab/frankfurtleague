import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPathAsSpelled } from "./apiPath.ts";

const BASE = "http://api:8000/api/v0";
const BASE_PATH = new URL(BASE).pathname;

/** Built exactly as `fl_frontend/src/core/api.ts` builds it, so the test cannot pass on a shape it invented. */
function endpointFor(id: string): { endpoint: string; pathname: string } {
  const endpoint = `/bewerbungen/${id}`;

  return { endpoint, pathname: new URL(`${BASE}${endpoint}`).pathname };
}

describe("isPathAsSpelled", () => {
  const ECHT = "68f0a1b2c3d4e5f6a7b8c9d0";
  const RENAVIGIEREND = ["../teams", "../../admin", "a/../../teams", ".", "..", "x/./y"];

  it("lets an ordinary id through", () => {
    const { endpoint, pathname } = endpointFor(ECHT);

    assert.equal(isPathAsSpelled(endpoint, pathname, BASE_PATH), true);
    assert.equal(pathname, `${BASE_PATH}/bewerbungen/${ECHT}`);
  });

  it("accepts no id the URL parser rewrote", () => {
    // The property rather than the six spellings: whatever renavigation a segment is spelled as, the
    // parser resolves it before any check runs, and what it produced is what would be requested.
    for (const id of RENAVIGIEREND) {
      const { endpoint, pathname } = endpointFor(id);

      assert.equal(
        isPathAsSpelled(endpoint, pathname, BASE_PATH),
        pathname === `${BASE_PATH}${endpoint}`,
        `"${id}" was judged against the wrong path`,
      );
      assert.equal(isPathAsSpelled(endpoint, pathname, BASE_PATH), false, `"${id}" reaches ${pathname}`);
    }
  });

  it("keeps an inline query out of the comparison", () => {
    // A call site may spell `?a=b` into the endpoint, which lands in `search` and never in `pathname`.
    const endpoint = "/bewerbungen?status=offen";

    assert.equal(isPathAsSpelled(endpoint, `${BASE_PATH}/bewerbungen`, BASE_PATH), true);
  });
});

import { describe, expect, it } from "vitest";

import { metadataFor } from "@/shared/utils/notFoundMetadata.ts";

describe("metadataFor", () => {
  /* Nothing else sees it: the page answers 200 either way, and only the tag keeps an outage's page out of the index. */
  it("answers a failed read with noindex", async () => {
    const metadata = metadataFor(Promise.reject(new Error("refused")), () => ({ title: "Ein Datensatz" }));

    await expect(metadata).resolves.toEqual({ robots: { index: false } });
  });
});

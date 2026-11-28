import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { thrownRedirect } from "@/test-support/thrownRedirect";
import { filesUnder } from "@/test-support/treeWalk";

// No answer of its own: a malformed id leaves no read to send, so any request the page makes fails the case.
const backend = serveBackend();
const { arriveAs } = signedInRequest(null);

const ADMIN_DIR = path.join(import.meta.dirname, "../../app/admin");

/** Every admin page naming a record, the season's own segment aside, with its address's params all malformed. */
const RECORD_PAGES = filesUnder(ADMIN_DIR, (name) => name === "page.tsx", 10).flatMap((file) => {
  const segments = path.relative(ADMIN_DIR, file).split(path.sep);
  const names = segments.flatMap((segment) => /^\[(.+)\]$/.exec(segment)?.[1] ?? []);
  return names.some((name) => name !== "saison") ? [{ file, params: Object.fromEntries(names.map((name) => [name, "nope"])) }] : [];
});

type Page = { generateMetadata: (props: unknown) => Promise<unknown> };

const metadataOf = async ({ file, params }: (typeof RECORD_PAGES)[number]) => {
  const { generateMetadata } = (await import(/* @vite-ignore */ file)) as Page;
  return generateMetadata({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
};

describe("an admin page's malformed record id", () => {
  // No read is left to run on such an id, and the frame draws without waiting for the session: an unjudged page would
  // show a person with no rights the administration's rail around the not-found card.
  it("turns a person with no rights away, as a well-formed id does", async () => {
    // Signed in, the lookup holding no grant for the address.
    await arriveAs({ email: "pia@example.org" });
    expect(RECORD_PAGES.length).toBeGreaterThan(0);

    for (const page of RECORD_PAGES) {
      expect((await thrownRedirect(metadataOf(page))).address, page.file).toBe(ROUTES.signInLanding.path());
    }
    // The guard read the signed-in person's records, which it reads for nobody signed out: the turn-away is the
    // missing grant's, not a missing session's.
    expect(backend.served.filter(({ path }) => path === "/identity/subject").map(({ body }) => body)).toContainEqual(
      expect.objectContaining({ email: "pia@example.org" }),
    );
  });

  it("answers an administrator not-found", async () => {
    await arriveAs({ email: "vorstand@example.org", admin: true });

    for (const page of RECORD_PAGES) {
      await expect(metadataOf(page), page.file).resolves.toBe(NOT_FOUND_METADATA);
    }
  });
});

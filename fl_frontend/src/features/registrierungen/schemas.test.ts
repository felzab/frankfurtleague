import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { buildRegistrierungBestaetigungPayloadSchema } from "./schemas.ts";

describe("the birth date the page's own schema accepts", () => {
  /* The page judges the date against the German day as the endpoint does, so a youngest date one day short
     of the floor is told to correct a date the endpoint would take, and one a day past it is let through to a
     refusal. The bound is worked out here from the day, never read back off the helper the schema calls. */
  it("takes the latest date the floor allows and refuses the day after it", () => {
    const mindestalter = 16;
    const latest = parseDate(getGermanTodayStr()).subtract({ years: mindestalter });
    const schema = buildRegistrierungBestaetigungPayloadSchema(mindestalter, "confirmation_spieler");
    const answer = { token: "kein-echtes-token", scope: "internal", media: false, text_versions: SPIELER_TEXT_VERSIONS };

    expect(schema.safeParse({ ...answer, birth_date: latest.toString() }).success, "the latest date the floor allows is refused").toBe(true);
    expect(
      schema.safeParse({ ...answer, birth_date: latest.add({ days: 1 }).toString() }).success,
      "a day younger than the floor is accepted",
    ).toBe(false);
  });
});

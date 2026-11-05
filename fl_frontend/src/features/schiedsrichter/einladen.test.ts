import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers } from "@/test-support/apiClientDouble.ts";
import { doubleOutbox } from "@/test-support/mailDouble.ts";
import { beforeEach, describe, expect, it } from "vitest";

/* The old create, which the old match form's create dialog still sends, its mutation called: the request it runs in,
   the backend client and the mailer are the doubles. The mailer's double also stills the drain behind the response,
   which the backend's Postausgang feeds: a create owing a link sends nothing itself. */
doubleActionRequest();
doubleOutbox();

/** What the create answers in this case, returned or, where it is an `Error`, thrown. */
let create: () => unknown;

doubleApiAnswers(async () => {
  const answer = create();
  if (answer instanceof Error) throw answer;
  return answer;
});

const { postSchiedsrichterAction } = await import("./actions.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/test-support/refusedPayload.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

beforeEach(() => {
  create = () => ({ created_id: SCHIEDSRICHTER_ID, confirmation: { frist: "2026-10-05", email: "anna@example.de" } });
});

const ENTWURF = { name: "Anna Meier", default_payment: 20, schule: null, kontakt: { email: "anna@example.de", telefon: null } };

describe("what the create tells the administrator", () => {
  it("names the address the link goes to rather than the title the toast already carries", async () => {
    const res = await postSchiedsrichterAction(ENTWURF);

    expect(res.success ? res.message : "").toMatch(/anna@example\.de/);
  });

  /* The cleared box submits `null`: refused on that box in German, before the endpoint is reached,
     because a referee entered without an address is a person never told of it. */
  it("refuses a create without an address on the address box, reaching no endpoint", async () => {
    create = () => {
      throw new Error("the create reached the endpoint");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: null, telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors?.["kontakt.email"]).toBe("Bitte gib eine E-Mail-Adresse ein.");
  });

  /* A label RFC 5890 reserves passes the form's rule and only the API refuses it: its 422 names the box,
     and the create answers there rather than in a toast naming no field. */
  it("puts an address only the API refuses on the address box", async () => {
    create = () => {
      throw refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: "anna@ab--cd.de", telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors).toStrictEqual({ "kontakt.email": FELD_ABGELEHNT });
  });
});

import { expect, it } from "vitest";

const { serializeQuery } = await import("./transport.ts");

/* Every generated call's query passes through here: a list sent as one joined value would reach FastAPI as a single
   unknown member and refuse the read, and a null sent as "null" would filter on that word. */
it("sends a list as one key per value and leaves an absent value out", () => {
  expect(serializeQuery({ status: ["eingereicht", "zugesagt"], q: "Gymnasium", seite: 2, empty: null, offen: undefined })).toBe(
    "status=eingereicht&status=zugesagt&q=Gymnasium&seite=2",
  );
});

import { describe, expect, it } from "vitest";

import { COPY } from "./copy.ts";

const { HOLDER_WAIT } = await import("./addressChange.ts");
const { mailFor } = await import("./mailKinds.ts");
const { renderMail } = await import("./emailShell.ts");
const { SERVER_COPY } = await import("./serverCopy.ts");

const LINK = { token: "example-one", secret: null, origin: "http://localhost:3000" };

const text = (mail: ReturnType<typeof mailFor>) => {
  if (mail === undefined) throw new Error("the kind has no builder");

  return renderMail(mail).text;
};

describe("a holder's own change", () => {
  /* Its reader decides by the wait, which a row a handover names serves as the owner's. */
  it.each(["administration", "owner"] as const)("states the %s's wait to either address", (holder) => {
    const wait = COPY.account.address.holderWait(HOLDER_WAIT[holder]);

    expect(text(mailFor("address_change_link", { kind: "address_change_link", way: "account", holder }, LINK))).toContain(wait);
    expect(text(mailFor("address_change_notice", { kind: "address_change_notice", way: "account", holder }, LINK))).toContain(wait);
  });
});

describe("a lost mailbox's notice", () => {
  /* Its stop answers past every deadline, so a lifetime here would turn a stranger's stop away for nothing. */
  it("states no link's lifetime", () => {
    const notice = text(mailFor("address_change_notice", { kind: "address_change_notice", way: "waiting_period", holder: null }, LINK));

    expect(notice).toContain(COPY.account.address.stop);
    expect(notice).not.toContain(SERVER_COPY.mail.linkValidFor(24));
  });
});

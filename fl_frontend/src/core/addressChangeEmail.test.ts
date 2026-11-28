import { describe, expect, it } from "vitest";

import { ACCOUNT_COPY } from "./copy/account";

const { HOLDER_WAIT } = await import("./addressChange");
const { mailFor } = await import("./mailKinds");
const { renderMail } = await import("./emailShell");
const { SERVER_COPY } = await import("./serverCopy");

const LINK = { token: "example-one", secret: null, origin: "http://localhost:3000", to: "kontakt@schule.example.org" };

const text = (mail: ReturnType<typeof mailFor>) => {
  if (mail === undefined) throw new Error("the kind has no builder");

  return renderMail(mail).text;
};

describe("a holder's own change", () => {
  /* Its reader decides by the wait, which a row a handover names serves as the owner's. */
  it.each(["administration", "owner"] as const)("states the %s's wait to either address", (holder) => {
    const wait = ACCOUNT_COPY.address.holderWait(HOLDER_WAIT[holder]);

    expect(text(mailFor("address_change_link", { kind: "address_change_link", way: "account", holder }, LINK))).toContain(wait);
    expect(text(mailFor("address_change_notice", { kind: "address_change_notice", way: "account", holder }, LINK))).toContain(wait);
  });
});

describe("a lost mailbox's notice", () => {
  /* Its stop answers past every deadline, so a lifetime here would turn a stranger's stop away for nothing. */
  it("states no link's lifetime", () => {
    const notice = text(mailFor("address_change_notice", { kind: "address_change_notice", way: "waiting_period", holder: null }, LINK));

    expect(notice).toContain(ACCOUNT_COPY.address.stop);
    expect(notice).not.toContain(SERVER_COPY.mail.linkValidFor(24));
  });
});

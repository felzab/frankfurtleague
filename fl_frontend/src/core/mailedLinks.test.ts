import { readFileSync } from "node:fs";
import path from "node:path";

import { assertRedactedAtTheEdge } from "@/test-support/edgeRedaction.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes.ts";

import type { Mail } from "./emailShell.ts";

const { mailFor } = await import("./mailKinds.ts");

const SOURCE = path.resolve(import.meta.dirname, "..");

const ORIGIN = "http://localhost:3000";

/** Made up, and spelled so no other part of a mail can hold it by chance. */
const TOKEN = "example-mailed-link-token";

const LINK = { token: TOKEN, secret: null, origin: ORIGIN };

/** A page whose address takes no segment, as every page a mailed link opens is. */
type FixedRoute = { [K in keyof typeof ROUTES]: (typeof ROUTES)[K]["path"] extends () => string ? K : never }[keyof typeof ROUTES];

/** Each link builder's page, and one mail calling the builder through the drain's own `mailFor`, its token made up. */
const BUILDERS: readonly { readonly route: FixedRoute; readonly mail: () => Mail | undefined }[] = [
  {
    route: "registrierungConfirmation",
    mail: () =>
      mailFor("registrierung_confirmation", { kind: "registrierung_confirmation", saison_id: "2627", team: "Goethe-Gymnasium" }, LINK),
  },
  { route: "registrierung", mail: () => mailFor("invitation", { kind: "invitation", saison_id: "2627", team: "Goethe-Gymnasium" }, LINK) },
  {
    route: "kontaktConfirmation",
    mail: () =>
      mailFor(
        "kontakt_confirmation",
        {
          kind: "kontakt_confirmation",
          saison_id: "2627",
          schule: "Lessing-Kolleg",
          rollen: ["ansprechperson"],
          deadline: "2026-10-17",
          row: "open",
        },
        LINK,
      ),
  },
  {
    route: "addressChangeConfirmation",
    mail: () => mailFor("address_change_link", { kind: "address_change_link", way: "account", holder: null }, LINK),
  },
  // The erasure's token is the row's secret, which the drain opens, rather than a minted link token.
  {
    route: "accountErasure",
    mail: () => mailFor("account_erasure", { kind: "account_erasure" }, { token: null, secret: TOKEN, origin: ORIGIN }),
  },
  {
    route: "schiedsrichterConfirmation",
    mail: () => mailFor("schiedsrichter_confirmation", { kind: "schiedsrichter_confirmation", deadline: "2026-10-17" }, LINK),
  },
];

/** The one link of `mail` that carries the made-up token, its button's or its passed-on block's. */
function tokenLinkOf(mail: Mail | undefined): string {
  if (mail === undefined) throw new Error("the kind has no builder");

  const links = [mail.button?.href, mail.block !== undefined && "link" in mail.block ? mail.block.link : undefined];
  const carrying = links.filter((link) => link?.includes(TOKEN) === true);
  if (carrying.length !== 1 || carrying[0] === undefined) throw new Error(`the mail carries the token in ${String(carrying.length)} links`);

  return carrying[0];
}

/**
 * Every page the source puts a query on, once per spelling: a mailed link is a page's address with its token in the
 * query, and the comment at each builder says it is the one place that link is spelled.
 */
function spelledQueryPages(): string[] {
  const sources = filesUnder(SOURCE, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name), 400);
  const pages = sources.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/ROUTES\.(\w+)\.path\([^`\n]*?\)\}\?/g)].map((match) => match[1] ?? ""),
  );

  return pages.toSorted();
}

describe("a mailed link's token", () => {
  // nginx redacts a token in its access log by the parameter's name alone, so a builder renamed to any other name
  // writes every live token of its kind, a minor's included, into the log with nothing else failing.
  it.each(BUILDERS)("rides in a parameter the edge redacts, on the $route page", ({ route, mail }) => {
    const link = tokenLinkOf(mail());

    expect(new URL(link).pathname).toBe(ROUTES[route].path());
    assertRedactedAtTheEdge(link);
  });

  // The table is held to the tree rather than to a list kept beside it, so a builder added later fails here until it
  // takes a row.
  it("is spelled by no builder the table leaves out", () => {
    expect(spelledQueryPages()).toStrictEqual(BUILDERS.map(({ route }) => route).toSorted());
  });
});

/**
 * E2E · no page moves while it loads: every page each role reaches in the made-up seed's three seasons, at a phone's
 * size and a desktop's, by a hard load, by a client navigation from the link a person presses, and by a hard load at a
 * viewport 4000 px tall. Its budget is zero (`../support/layoutShift.ts`).
 *
 * The tall pass is there because the API counts only nodes in view: a wait below the first screen that lands at another
 * size moves boxes nobody measures at 844 or 900 px. At 4000 px most pages stand whole in view, and the frame's `main`
 * holds the footer at the bottom of the screen, so the footer moves for nothing that grows above it.
 *
 * Each case is a walk: its first address is loaded, each later one is the address of the first visible link on the page
 * before it that matches it, `<id>` standing for a record's id the seed mints anew on every run. The last is the page
 * measured and the one before it the origin its client navigation presses the link on. A walk of one address is a page
 * no link of the site leads to, such as a mailed link's, and has no client navigation. The landing's cases carry
 * `@landing`, which CI runs again under each state `scripts/ops/seed/seed.js :: SEED_LANDING` seeds, and the signed-in
 * roles' `@signed-in`, the leg holding the administrator's session.
 *
 * On a development machine, a second run against one start of the end-to-end stack passes `--no-deps` and reads the
 * sessions the first saved: the administrator's setup enrols a passkey once per start, and the stack mails an address
 * five codes an hour.
 */
import { expect } from "@playwright/test";

import { ADMINISTRATOR_STATE, test } from "../support/journey";
import { expectStill, recordShifts, sessionFile, settle } from "../support/layoutShift";

import type { Page } from "@playwright/test";
import type { ShiftRecord } from "../support/layoutShift";

type Role = "visitor" | "pupil" | "referee" | "contact" | "administrator";

/**
 * The session each role's pages are read under: none for a visitor, the one `../support/administrator.setup.ts` saves
 * for the administrator, and those `./sessions.setup.ts` saves for the others.
 */
function sessionOf(role: Role): string | undefined {
  if (role === "visitor") return undefined;
  if (role === "administrator") return ADMINISTRATOR_STATE;
  return sessionFile(role);
}

/** A case: the addresses walked to the page measured, the last being that page. */
type Walk = readonly string[];

/** A record's id as the seed mints it, in a walk's address. */
const ID = "<id>";

/** Whether `path` is the address a walk's step names. */
function matches(step: string, path: string): boolean {
  const pattern = step
    .split(ID)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[0-9a-f]{24}");
  return new RegExp(`^${pattern}$`).test(path);
}

/** The addresses of the links a person can see on `page`, in the document's order, each as a path and its query. */
async function visibleLinks(page: Page): Promise<string[]> {
  const links = await page
    .locator("a[href]")
    .evaluateAll((anchors) => anchors.filter((anchor) => anchor.checkVisibility()).map((anchor) => (anchor as HTMLAnchorElement).href));
  return links.map((href) => {
    const url = new URL(href);
    return url.pathname + url.search;
  });
}

/**
 * Walks `steps` on `page` and answers the address of each, the first loaded and every later one read off the visible
 * link the page before it holds.
 */
async function walk(page: Page, record: ShiftRecord, steps: Walk): Promise<string[]> {
  const [first, ...rest] = steps;
  if (first === undefined) throw new Error("a walk names at least one address");
  const addresses = [first];
  for (const step of rest) {
    await page.goto(addresses.at(-1) ?? first);
    await settle(page, record);
    const found = (await visibleLinks(page)).find((address) => matches(step, address.split("?")[0] ?? address) || address === step);
    if (found === undefined) throw new Error(`${page.url()} shows no link to ${step}`);
    addresses.push(found);
  }
  return addresses;
}

/** The address a walk measures: its last step as written, or, where that names a record, the link that leads to it. */
async function addressOf(page: Page, record: ShiftRecord, steps: Walk): Promise<string> {
  const target = steps.at(-1) ?? "";
  return target.includes(ID) ? ((await walk(page, record, steps)).at(-1) ?? target) : target;
}

/** Where a signed-in role must not land: its session has lapsed, and the page measured would be the sign-in's. */
async function expectSignedIn(page: Page, role: Role): Promise<void> {
  if (role === "visitor") return;
  await expect(page, "the session reached the page rather than the sign-in").not.toHaveURL((url) => url.pathname.startsWith("/signin"));
}

/** A phone at an iPhone's size in Chromium, which reports layout shift where WebKit does not, and a laptop's screen. */
const WIDTHS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;

/** The viewport's height in the tall pass. */
const TALL = 4000;

/** A season's public pages under its Spielplan, which the case before them reaches. */
const SEASON_PUBLIC = (saison: string): Walk[] => [
  [`/saisons/${saison}`, `/saisons/${saison}/tabelle`],
  [`/saisons/${saison}`, `/saisons/${saison}/ko-runde`],
  [`/saisons/${saison}`, `/saisons/${saison}/teams`],
];

const VISITOR: Walk[] = [
  ["/about", "/"],
  ["/", "/about"],
  ["/", "/contact"],
  ["/", "/datenschutz"],
  ["/", "/impressum"],
  ["/", "/sitemap"],
  ["/", "/sponsors"],
  ["/", "/signin"],
  // The erasure's link is mailed, so a visitor without one meets its refusal.
  ["/erasure"],
  ["/erasure/done"],
  ["/", "/bewerbung/2028"],
  ["/registrierung?token=made-up-kastanie-invitation"],
  ["/registrierung/done"],
  // Each confirmation page by a link the seed holds open, which a GET only reads: an open seat, a registration, an
  // address change, and a referee's link nobody minted, the page's refusal.
  ["/confirm/kontakt?token=made-up-weide-ansprechperson"],
  ["/confirm/spieler?token=made-up-ole-registration"],
  ["/confirm/address?token=made-up-noll-new"],
  ["/confirm/schiedsrichter?token=made-up-nobody"],
  ["/", "/saisons/2027"],
  ...SEASON_PUBLIC("2027"),
  ["/saisons/2027", `/saisons/2027/search`],
  ["/saisons/2027/teams", `/saisons/2027/teams/${ID}`],
  ["/saisons/2027", `/saisons/2027/spiele/${ID}`],
  ["/sitemap", "/saisons/2026"],
  ...SEASON_PUBLIC("2026"),
  ["/saisons/2026/teams", `/saisons/2026/teams/${ID}`],
  ["/saisons/2026", `/saisons/2026/spiele/${ID}`],
  // The planned season, which the public does not read: its address answers the page for a season not found.
  ["/saisons/2028"],
  // The addresses that answer for the season the site is on.
  ["/saisons"],
  ["/saisons/tabelle"],
  ["/saisons/ko-runde"],
  ["/saisons/teams"],
];

const ACCOUNT: Walk[] = [
  ["/account/entries", "/account"],
  ["/account", "/account/entries"],
  ["/account", "/account/security"],
  ["/account", "/account/signin"],
  ["/account", "/account/appearance"],
  ["/signin/passkey"],
];

const PUPIL: Walk[] = [
  ["/area"],
  ["/area/spieler"],
  ["/account", "/area/spieler/2027"],
  ["/area/spieler/2027", "/area/spieler/2026"],
  ["/area/spieler/2027", "/saisons/2027"],
  ...ACCOUNT,
];

const REFEREE: Walk[] = [
  ["/account", "/area/schiedsrichter"],
  ["/area/schiedsrichter", "/area/schiedsrichter/2027"],
  ["/area/schiedsrichter/2027", "/area/schiedsrichter/2026"],
  ["/area/schiedsrichter", `/area/schiedsrichter/2027/spielbericht/${ID}`],
  ...ACCOUNT,
];

const TEAM = `/area/team/${ID}/2027`;
const CONTACT: Walk[] = [
  ["/area", `${TEAM}/spiele`, TEAM],
  ["/area", `${TEAM}/spiele`],
  ["/area", `${TEAM}/kader`],
  ["/area", `${TEAM}/registrierungen`],
  ["/area", `${TEAM}/spiele`, `${TEAM}/spiele/${ID}`],
  ...ACCOUNT,
];

const ADMIN_SEASON = (saison: string): Walk[] => [
  ["/admin/saisons", `/admin/saisons/${saison}`],
  [`/admin/saisons/${saison}`, `/admin/saisons/${saison}/settings`],
  [`/admin/saisons/${saison}`, `/admin/saisons/${saison}/spiele`],
  [`/admin/saisons/${saison}`, `/admin/saisons/${saison}/teams`],
  [`/admin/saisons/${saison}`, `/admin/saisons/${saison}/teams`, `/admin/saisons/${saison}/teams/${ID}`],
  [`/admin/saisons/${saison}`, `/admin/saisons/${saison}/spieler`],
];

const ADMINISTRATOR: Walk[] = [
  ["/admin/saisons", "/admin"],
  ["/admin", "/admin/saisons"],
  ...ADMIN_SEASON("2026"),
  ...ADMIN_SEASON("2027"),
  ...ADMIN_SEASON("2028"),
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spiele/${ID}`],
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spieltage/${ID}`],
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spiele/${ID}`, `/admin/saisons/2027/spiele/${ID}/aufstellung/${ID}`],
  [`/admin/saisons/2026/spiele`, `/admin/saisons/2026/spiele/${ID}`],
  [`/admin/saisons/2027`, `/admin/saisons/2027/spieler`, `/admin/saisons/2027/spieler/${ID}`],
  [`/admin/saisons/2027`, `/admin/saisons/2027/registrierungen`],
  [`/admin/saisons/2028`, `/admin/saisons/2028/bewerbungen`],
  [`/admin/saisons/2028`, `/admin/saisons/2028/bewerbungen`, `/admin/saisons/2028/bewerbungen/${ID}`],
  [`/admin/saisons/2028/bewerbungen`, `/admin/saisons/2028/bewerbungen/bulk`],
  ["/admin", "/admin/spielorte"],
  ["/admin/spielorte", `/admin/spielorte/${ID}`],
  ["/admin", "/admin/schiedsrichter"],
  ["/admin/schiedsrichter", `/admin/schiedsrichter/${ID}`],
  ["/admin", "/admin/administrators"],
  ["/admin", "/admin/ban-list"],
  ["/admin", "/admin/erasures"],
  ["/admin", "/admin/address-changes"],
  ["/admin", "/admin/log"],
  ...ACCOUNT,
];

const ROLES: Record<Role, readonly Walk[]> = {
  visitor: VISITOR,
  pupil: PUPIL,
  referee: REFEREE,
  contact: CONTACT,
  administrator: ADMINISTRATOR,
};

for (const [role, walks] of Object.entries(ROLES) as [Role, readonly Walk[]][]) {
  test.describe(role, { tag: role === "visitor" ? [] : ["@signed-in"] }, () => {
    test.use({ storageState: sessionOf(role) });

    for (const [width, device] of Object.entries(WIDTHS)) {
      for (const steps of walks) {
        const target = steps.at(-1) ?? "";
        const origin = steps.at(-2);
        // The landing's cases, which CI runs again under each state the seed can give it.
        const tag = target === "/" ? ["@landing"] : [];

        test.describe(`at ${width} px`, () => {
          test.use(device);

          test(`${target} by a hard load`, { tag }, async ({ page, context }) => {
            const record = await recordShifts(context);
            const address = await addressOf(page, record, steps);
            await expectStill(page, record, () => page.goto(address));
            await expectSignedIn(page, role);
          });

          if (origin !== undefined) {
            test(`${target} by the link on ${origin}`, { tag }, async ({ page, context }) => {
              const record = await recordShifts(context);
              // The walk ends on the origin, settled, its link to the target read.
              const to = (await walk(page, record, steps)).at(-1) ?? target;
              const link = page.locator(`a[href="${to}"]`).filter({ visible: true }).first();
              await expectStill(page, record, async () => {
                await (device.hasTouch ? link.tap() : link.click());
                await expect(page).toHaveURL((url) => url.pathname === to.split("?")[0]);
              });
              await expectSignedIn(page, role);
            });
          }
        });

        test.describe(`at ${width} by ${String(TALL)} px`, () => {
          test.use({ ...device, viewport: { width: device.viewport.width, height: TALL } });

          test(`${target} by a hard load`, { tag }, async ({ page, context }) => {
            const record = await recordShifts(context);
            const address = await addressOf(page, record, steps);
            await expectStill(page, record, () => page.goto(address));
            await expectSignedIn(page, role);
          });
        });
      }
    }
  });
}

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
 * before it that matches it, `<id>` standing for a record's id the seed mints anew on every run. A step a person reaches
 * through a control names it: the walk presses „Mehr“, the season button or the account's control as a person does,
 * and reads the link in what it opened. The last address is the page measured and the one before it the origin its
 * client navigation presses the link on. A walk of one address is a page no link of the site leads to, such as a mailed
 * link's, and has no client navigation. Where the way differs between the widths, a case names a walk for each, and a
 * width it names none for has no way to the page. The landing's cases carry `@landing`, which CI runs again under each
 * state `scripts/ops/seed/seed.js :: SEED_LANDING` seeds, and the signed-in roles' `@signed-in`, the leg holding the
 * administrator's session.
 *
 * On a development machine, a second run against one start of the end-to-end stack passes `--no-deps` and reads the
 * sessions the first saved: the administrator's setup enrols a passkey once per start, and the stack mails an address
 * five codes an hour. The newcomer's session is the one no setup saves: its passkey offer lapses five minutes after its
 * sign-in, so each worker signs it in afresh for its own cases.
 */
import { expect } from "@playwright/test";

import { ADMINISTRATOR_STATE, test as journey } from "../support/journey";
import { expectStill, NEWCOMER, recordShifts, sessionFile, settle } from "../support/layoutShift";
import { signInWithCode } from "../support/signIn";
import { standInForTurnstile } from "../support/turnstileStandIn";

import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { ShiftRecord } from "../support/layoutShift";

type Role = "visitor" | "pupil" | "referee" | "contact" | "administrator" | "newcomer";

/** A session as a context saves it, which a context's `storageState` takes back. */
type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * The guard's `test`, with the newcomer's session signed in once per worker, as Playwright's guide signs in an account
 * per worker (https://playwright.dev/docs/auth#moderate-one-account-per-parallel-worker), but never read back from an
 * earlier run: the offer it is signed in for lapses five minutes after the sign-in. Signed in only by a worker running a
 * case that reads it, in a context of its own with no session, Turnstile's stand-in on it as every journey's context has.
 */
const test = journey.extend<Record<never, never>, { newcomerSession: Session }>({
  newcomerSession: [
    async ({ browser }, provide, { project }) => {
      const context = await browser.newContext({ baseURL: project.use.baseURL, locale: project.use.locale });
      await standInForTurnstile(context);
      const page = await context.newPage();
      await signInWithCode(page, NEWCOMER);
      await expect(page.getByRole("button", { name: "Später" }), "the sign-in offers the newcomer a passkey").toBeVisible();
      const session = await context.storageState();
      await context.close();
      await provide(session);
    },
    { scope: "worker" },
  ],
});

/**
 * The session each role's pages are read under, a path to its file: none for a visitor, the one
 * `../support/administrator.setup.ts` saves for the administrator, and those `./sessions.setup.ts` saves for the
 * others but the newcomer, whose is the worker's own.
 */
function sessionOf(role: Exclude<Role, "newcomer">): string | undefined {
  if (role === "visitor") return undefined;
  if (role === "administrator") return ADMINISTRATOR_STATE;
  return sessionFile(role);
}

/** A phone at an iPhone's size in Chromium, which reports layout shift where WebKit does not, and a laptop's screen. */
const WIDTHS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;

type Width = keyof typeof WIDTHS;

/**
 * The controls a person opens to reach a link they hold, each found as Playwright finds a control a person sees. „Mehr“
 * is the phone bar's alone: from 1024 px the rail lists every entry the bar keeps behind it, so there the link stands
 * in view.
 */
const OPENERS = {
  more: { phoneOnly: true, control: (page: Page) => page.getByRole("button", { name: "Mehr", exact: true }) },
  // In the rail's head, or on the phone's band, named by the season it stands on.
  saison: { phoneOnly: false, control: (page: Page) => page.getByRole("button", { name: /^Saison \d{4}/ }) },
  // The phone bar's „Konto“, or the rail's foot, the row naming the person, which is the last button the rail holds.
  account: {
    phoneOnly: false,
    control: (page: Page) =>
      page.getByRole("button", { name: "Konto", exact: true }).or(page.getByRole("complementary").getByRole("button").last()),
  },
} as const;

/** A step of a walk: the address of a link in view, or of one in what a control opens. */
type Step = string | { readonly open: keyof typeof OPENERS; readonly to: string };

/** The addresses walked to the page measured, the first loaded and the last being that page. */
type Steps = readonly [string, ...Step[]];

/** A case: one walk at both widths, or a walk at each width its way differs at. */
type Walk = Steps | { readonly [W in Width]?: Steps };

const isSteps = (walk: Walk): walk is Steps => Array.isArray(walk);

/** The link in the phone bar's „Mehr“, in the rail from 1024 px. */
const more = (to: string): Step => ({ open: "more", to });
/** The link in the season button's list. */
const saison = (to: string): Step => ({ open: "saison", to });
/** The link in the account's menu. */
const account = (to: string): Step => ({ open: "account", to });

const addressOfStep = (step: Step): string => (typeof step === "string" ? step : step.to);

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

/** What a pressed control opens: the phone's sheet, or the desktop's menu. */
const OPENED = '[role="dialog"], [role="menu"]';

/** The addresses of the links a person can see in `scope`, in the document's order, each as a path and its query. */
async function visibleLinks(scope: Locator): Promise<string[]> {
  const links = await scope
    .locator("a[href]")
    .evaluateAll((anchors) => anchors.filter((anchor) => anchor.checkVisibility()).map((anchor) => (anchor as HTMLAnchorElement).href));
  return links.map((href) => {
    const url = new URL(href);
    return url.pathname + url.search;
  });
}

/** Presses `control` as the device does: a finger's tap on a phone, the pointer's click on a desktop. */
async function press(control: Locator, phone: boolean): Promise<void> {
  await (phone ? control.tap() : control.click());
}

/**
 * Where `step`'s link stands on the settled page: in view, or in what its control opens, which is pressed and waited
 * for. A control a person cannot see fails the walk.
 */
async function scopeOf(page: Page, record: ShiftRecord, step: Step, phone: boolean): Promise<Locator> {
  if (typeof step === "string") return page.locator(":root");
  const opener = OPENERS[step.open];
  if (opener.phoneOnly && !phone) return page.locator(":root");
  const control = opener.control(page).filter({ visible: true });
  await expect(control, `${page.url()} shows its ${step.open} control`).toHaveCount(1);
  await press(control, phone);
  const opened = page.locator(OPENED).filter({ visible: true });
  await expect(opened.first()).toBeVisible();
  await settle(page, record);
  return opened;
}

/**
 * Walks `steps` on `page` and answers the address of each, the first loaded and every later one read off the visible
 * link the page before it holds, with the link to the last, which stands open where a control holds it.
 */
async function walk(page: Page, record: ShiftRecord, steps: Steps, phone: boolean): Promise<{ addresses: string[]; link: Locator }> {
  const [first, ...rest] = steps;
  const addresses = [first];
  let link = page.locator("a[href]");
  for (const step of rest) {
    const target = addressOfStep(step);
    await page.goto(addresses.at(-1) ?? first);
    await settle(page, record);
    const scope = await scopeOf(page, record, step, phone);
    const found = (await visibleLinks(scope)).find((address) => matches(target, address.split("?")[0] ?? address) || address === target);
    if (found === undefined) throw new Error(`${page.url()} shows no link to ${target}`);
    addresses.push(found);
    link = scope.locator(`a[href="${found}"]`).filter({ visible: true }).first();
  }
  // Brought into view as a person scrolls to it before pressing it, a sheet holding it expanding as it scrolls: the
  // press, which Playwright would otherwise scroll for itself, is the case's alone.
  if (rest.length > 0) {
    await link.scrollIntoViewIfNeeded();
    await settle(page, record);
  }
  return { addresses, link };
}

/** The address a walk measures: its last step as written, or, where that names a record, the link that leads to it. */
async function addressOf(page: Page, record: ShiftRecord, steps: Steps, phone: boolean): Promise<string> {
  const target = addressOfStep(steps.at(-1) ?? steps[0]);
  return target.includes(ID) ? ((await walk(page, record, steps, phone)).addresses.at(-1) ?? target) : target;
}

/**
 * Where a signed-in role must not land: its session has lapsed, and the page measured would be the sign-in's. The
 * newcomer's page is the passkey's offer, which leaves for the landing once the offer has lapsed.
 */
async function expectSignedIn(page: Page, role: Role): Promise<void> {
  if (role === "visitor") return;
  if (role === "newcomer") {
    await expect(page, "the session still holds the passkey's offer, which lapses five minutes after its sign-in").toHaveURL(
      (url) => url.pathname === "/signin/passkey",
    );
    return;
  }
  await expect(page, "the session reached the page rather than the sign-in").not.toHaveURL((url) => url.pathname.startsWith("/signin"));
}

/** The viewport's height in the tall pass. */
const TALL = 4000;

/** A season's public pages under its Spielplan, which the case before them reaches. */
const SEASON_PUBLIC = (season: string): Walk[] => [
  [`/saisons/${season}`, `/saisons/${season}/tabelle`],
  [`/saisons/${season}`, `/saisons/${season}/ko-runde`],
  [`/saisons/${season}`, `/saisons/${season}/teams`],
  [`/saisons/${season}`, `/saisons/${season}/search`],
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
  ["/saisons/2027/teams", `/saisons/2027/teams/${ID}`],
  ["/saisons/2027", `/saisons/2027/spiele/${ID}`],
  ["/sitemap", "/saisons/2026"],
  ...SEASON_PUBLIC("2026"),
  ["/saisons/2026/teams", `/saisons/2026/teams/${ID}`],
  ["/saisons/2026", `/saisons/2026/spiele/${ID}`],
  // The planned season, which the public does not read: its address answers the page for a season not found.
  ["/saisons/2028"],
  // The addresses that answer for the season the site is on, which the classic frame's header and footer link.
  ["/", "/saisons"],
  ["/", "/saisons/tabelle"],
  ["/", "/saisons/ko-runde"],
  ["/", "/saisons/teams"],
  ["/", "/saisons/search"],
];

/**
 * Konto's pages, reached from the area `home` walks to. A phone opens Konto on the list of its pages and a desktop on
 * its Anmeldung, each through the account's menu, and nothing links the list on a desktop.
 */
const ACCOUNT = (...home: Steps): Walk[] => [
  { 390: [...home, account("/account")], 1440: ["/account"] },
  { 390: ["/account", "/account/signin"], 1440: [...home, account("/account/signin")] },
  ["/account", "/account/security"],
  ["/account", "/account/appearance"],
  ["/account", "/account/entries"],
];

/** A person's area at an address no page holds, whose card leads to `/area`, which sends the person on to their place. */
const AREA: Walk[] = [
  ["/area/nowhere"],
  ["/area/nowhere", "/area"],
  // The chooser `/area` sends a person holding several places to; the seed seats nobody in two, so it shows one card.
  ["/area/roles"],
];

/** A session a moment after its sign-in, the passkey offered: the page a person reads before „Später“. */
const OFFERED: Walk[] = [["/signin/passkey"]];

const PUPIL: Walk[] = [
  ...AREA,
  ["/account", "/area/spieler"],
  ["/area/spieler", "/area/spieler/2027"],
  ["/area/spieler/2027", saison("/area/spieler/2026")],
  ["/area/spieler/2027", `/saisons/2027/teams/${ID}`],
  ...ACCOUNT("/area/spieler"),
];

const REFEREE: Walk[] = [
  ...AREA,
  ["/account", "/area/schiedsrichter"],
  ["/area/schiedsrichter", "/area/schiedsrichter/2027"],
  ["/area/schiedsrichter/2027", saison("/area/schiedsrichter/2026")],
  ["/area/schiedsrichter", `/area/schiedsrichter/2027/spielbericht/${ID}`],
  ["/area/schiedsrichter/2026", `/area/schiedsrichter/2026/spielbericht/${ID}`],
  ...ACCOUNT("/area/schiedsrichter"),
];

const TEAM = `/area/team/${ID}/2027`;
const CONTACT: Walk[] = [
  ...AREA,
  ["/account", TEAM],
  ["/account", TEAM, `${TEAM}/spiele`],
  ["/account", TEAM, `${TEAM}/kader`],
  ["/account", TEAM, more(`${TEAM}/registrierungen`)],
  ["/account", TEAM, `${TEAM}/spiele`, `${TEAM}/spiele/${ID}`],
  // A team's address no page holds, at a team the contact holds no seat on: the card refusing it.
  ["/area/team/000000000000000000000000/2027/nowhere"],
  ...ACCOUNT("/account", TEAM),
];

/** A season's administration pages but its Übersicht, from it or from the list of seasons. */
const ADMIN_SEASON = (season: string): Walk[] => [
  ["/admin/saisons", `/admin/saisons/${season}/settings`],
  [`/admin/saisons/${season}`, `/admin/saisons/${season}/spiele`],
  [`/admin/saisons/${season}`, `/admin/saisons/${season}/teams`],
  [`/admin/saisons/${season}`, `/admin/saisons/${season}/teams`, `/admin/saisons/${season}/teams/${ID}`],
  [`/admin/saisons/${season}`, more(`/admin/saisons/${season}/spieler`)],
  [`/admin/saisons/${season}`, more(`/admin/saisons/${season}/bewerbungen`)],
  [`/admin/saisons/${season}`, more(`/admin/saisons/${season}/registrierungen`)],
];

const ADMINISTRATOR: Walk[] = [
  ["/account", "/admin"],
  ["/admin", more("/admin/saisons")],
  ["/admin/saisons", "/admin/saisons/2027"],
  ["/admin/saisons/2027", saison("/admin/saisons/2026")],
  ["/admin/saisons/2027", saison("/admin/saisons/2028")],
  ...ADMIN_SEASON("2026"),
  ...ADMIN_SEASON("2027"),
  ...ADMIN_SEASON("2028"),
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spiele/${ID}`],
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spieltage/${ID}`],
  [`/admin/saisons/2027/spiele`, `/admin/saisons/2027/spiele/${ID}`, `/admin/saisons/2027/spiele/${ID}/aufstellung/${ID}`],
  [`/admin/saisons/2026/spiele`, `/admin/saisons/2026/spiele/${ID}`],
  [`/admin/saisons/2026/spiele`, `/admin/saisons/2026/spieltage/${ID}`],
  [`/admin/saisons/2026/spiele`, `/admin/saisons/2026/spiele/${ID}`, `/admin/saisons/2026/spiele/${ID}/aufstellung/${ID}`],
  [`/admin/saisons/2027`, more(`/admin/saisons/2027/spieler`), `/admin/saisons/2027/spieler/${ID}`],
  [`/admin/saisons/2026`, more(`/admin/saisons/2026/spieler`), `/admin/saisons/2026/spieler/${ID}`],
  [`/admin/saisons/2028`, more(`/admin/saisons/2028/bewerbungen`), `/admin/saisons/2028/bewerbungen/${ID}`],
  [`/admin/saisons/2028/bewerbungen`, `/admin/saisons/2028/bewerbungen/bulk`],
  ["/admin", more("/admin/spielorte")],
  ["/admin/spielorte", `/admin/spielorte/${ID}`],
  ["/admin", more("/admin/schiedsrichter")],
  ["/admin/schiedsrichter", `/admin/schiedsrichter/${ID}`],
  ["/admin", more("/admin/administrators")],
  ["/admin", more("/admin/ban-list")],
  ["/admin", more("/admin/erasures")],
  ["/admin", more("/admin/address-changes")],
  ["/admin", more("/admin/log")],
  // An administration address no page holds, its card leading to `/admin`.
  ["/admin/nowhere"],
  // The landing a signed-in person's way goes through, which sends an administrator on to `/admin`.
  ["/area"],
  ...ACCOUNT("/admin"),
  // The passkey page holds no step for a session that holds a passkey, and sends it on before drawing anything. Only
  // this session meets that redirect whatever the clock says: a code role's holds the offer for five minutes.
  ["/signin/passkey"],
];

const ROLES: Record<Role, readonly Walk[]> = {
  visitor: VISITOR,
  pupil: PUPIL,
  referee: REFEREE,
  contact: CONTACT,
  administrator: ADMINISTRATOR,
  newcomer: OFFERED,
};

for (const [role, walks] of Object.entries(ROLES) as [Role, readonly Walk[]][]) {
  test.describe(role, { tag: role === "visitor" ? [] : ["@signed-in"] }, () => {
    if (role === "newcomer") test.use({ storageState: async ({ newcomerSession }, provide) => provide(newcomerSession) });
    else test.use({ storageState: sessionOf(role) });

    for (const [width, device] of Object.entries(WIDTHS)) {
      const phone = device.hasTouch;
      for (const each of walks) {
        const steps = isSteps(each) ? each : each[Number(width) as Width];
        if (steps === undefined) continue;
        const target = addressOfStep(steps.at(-1) ?? steps[0]);
        const before = steps.length > 1 ? steps.at(-2) : undefined;
        const origin = before === undefined ? undefined : addressOfStep(before);
        // The landing's cases, which CI runs again under each state the seed can give it.
        const tag = target === "/" ? ["@landing"] : [];

        test.describe(`at ${width} px`, () => {
          test.use(device);

          test(`${target} by a hard load`, { tag }, async ({ page, context }) => {
            const record = await recordShifts(context);
            const address = await addressOf(page, record, steps, phone);
            await expectStill(page, record, () => page.goto(address));
            await expectSignedIn(page, role);
          });

          if (origin !== undefined) {
            test(`${target} by the link on ${origin}`, { tag }, async ({ page, context }) => {
              const record = await recordShifts(context);
              // The walk ends on the origin, settled, its link to the target read and, where a control holds it, open.
              const { addresses, link } = await walk(page, record, steps, phone);
              const from = addresses.at(-2);
              await expectStill(page, record, async () => {
                await press(link, phone);
                // Left the origin: the link's own address, or the page an address answering for another sends it to.
                await expect(page).toHaveURL((url) => url.pathname + url.search !== from);
              });
              await expectSignedIn(page, role);
            });
          }
        });

        test.describe(`at ${width} by ${String(TALL)} px`, () => {
          test.use({ ...device, viewport: { width: device.viewport.width, height: TALL } });

          test(`${target} by a hard load`, { tag }, async ({ page, context }) => {
            const record = await recordShifts(context);
            const address = await addressOf(page, record, steps, phone);
            await expectStill(page, record, () => page.goto(address));
            await expectSignedIn(page, role);
          });
        });
      }
    }
  });
}

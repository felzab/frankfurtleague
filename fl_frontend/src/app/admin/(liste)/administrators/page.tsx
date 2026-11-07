import { actLabel } from "@/kit/dialogAct";
import { ListPage } from "@/kit/ListPage";
import { OpenFoldPlaceholder, ReadFolds } from "@/kit/ReadFolds";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { judgeAdminRequest } from "@/core/auth/guards";
import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";
import { formatDate, formatInstantShort } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { discardChange } from "@/features/address-change/actions";
import { addAdministrator, removeAdministrator, startHandover, stopHandover } from "@/features/grants/actions";
import { getAddressChanges, getGrants } from "@/features/grants/queries";
import { GRANT_RULES } from "@/features/grants/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { RowAct } from "./RowAct";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLAddressChangeAdminOpen, FLGrantRow, FLGrantWaitHours, FLOwnerWaitDays } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { ListCreate } from "@/kit/ListPage";
import type { TableHead, TableProps, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.administrators;
const FACTS = COPY.admin.facts;
const MAIL_TO = COPY.admin.mailTo;
const ADDRESS = COPY.signIn.address;

const ADDITION_WAIT = { hours: 24 } as const satisfies { hours: FLGrantWaitHours };
const OWNER_WAIT = { days: 7 } as const satisfies { days: FLOwnerWaitDays };
const DAY_MS = 86_400_000;

/** The two toolbar acts, each naming its button, its wait and its dialog. */
const ADD = { verb: "enter", object: WORDS.object } as const;
const HAND_OVER = { verb: "handOver", object: WORDS.owner } as const;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminAdministrators, ROUTES.adminAdministrators.path());
}

/** A holder's address change in its wait, its date read. */
type WaitingChange = FLAddressChangeAdminOpen & { effective_from: string };

/** The grants as this reader sees them; `actor` is the address the owner's acts post, `null` for an administrator. */
type Access = {
  actor: string | null;
  /** Who holds access now, the owner first. */
  active: readonly FLGrantRow[];
  additions: readonly FLGrantRow[];
  handover: FLGrantRow | undefined;
  changes: readonly WaitingChange[];
};

const isWaitingChange = (change: FLAddressChangeAdminOpen): change is WaitingChange => change.effective_from !== null;

/**
 * Who holds access and what waits. A future `effective_from` is an addition no session holds yet; a holder's change is
 * a running change at a grant's address with its date set, which the server answers to the owner alone, and never the
 * reader's own, which Konto shows.
 */
async function readAccess(): Promise<Access> {
  const [{ grants }, { changes }, judged] = await Promise.all([getGrants(), getAddressChanges(), judgeAdminRequest()]);
  // The page's read turned a refused session away to the sign-in before this line.
  const holder = "session" in judged ? judged.session.user.email : "";
  const moment = now().getTime();
  const inEffect = grants.filter((grant) => new Date(grant.effective_from).getTime() <= moment);
  const owner = inEffect.filter((grant) => grant.admin_tier === "owner");
  const addresses = new Set(grants.map((grant) => grant.address));
  return {
    actor: owner.some((grant) => grant.address === asSignInIdentifier(holder)) ? holder : null,
    active: [...owner, ...inEffect.filter((grant) => grant.admin_tier !== "owner")],
    additions: grants.filter((grant) => !inEffect.includes(grant)),
    handover: grants.find((grant) => grant.owner_from !== null),
    changes: changes.filter(isWaitingChange).filter((change) => addresses.has(change.address)),
  };
}

const dayOf = (moment: string) => ({ record: formatDate(new Date(moment)) });

const instantOf = (moment: string) => ({ record: formatInstantShort(moment) });

/** One grant in effect: the owner's chip alone sets a row apart, and only an administrator's row can be removed. */
function activeRow(grant: FLGrantRow, actor: string | null): TableRow {
  const isOwner = grant.admin_tier === "owner";
  return {
    id: grant.id,
    name: { record: grant.address },
    ...(isOwner ? { chip: { tone: "neutral" as const, label: WORDS.owner } } : {}),
    cells: { since: dayOf(grant.effective_from) },
    ...(actor === null || isOwner
      ? {}
      : {
          acts: (
            <RowAct
              verb="remove"
              subject={WORDS.object}
              consequence={WORDS.removeConsequence}
              facts={[
                { label: ADDRESS, value: { record: grant.address } },
                { label: WORDS.since, value: dayOf(grant.effective_from) },
                { label: FACTS.mailTo, value: MAIL_TO.holdersAndPerson },
              ]}
              act={removeAdministrator}
              id={grant.id}
              holder={actor}
            />
          ),
        }),
  };
}

/** One waiting row: what waits and from when, and for the owner its withdrawal. */
function waitingRow({
  id,
  address,
  line,
  actor,
  consequence,
  facts,
  act,
}: {
  id: string;
  address: string;
  line: Copy;
  actor: string | null;
  consequence: Copy;
  facts: ReadonlyArray<Fact>;
  act: (input: { id: string; holder: string }) => Promise<ActionAnswer>;
}): TableRow {
  return {
    id,
    name: { record: address },
    line,
    cells: {},
    ...(actor === null
      ? {}
      : {
          acts: (
            <RowAct
              verb="withdraw"
              subject={COPY.account.address.change}
              consequence={consequence}
              facts={facts}
              act={act}
              id={id}
              holder={actor}
            />
          ),
        }),
  };
}

function waitingRows({ actor, additions, handover, changes }: Access): TableRow[] {
  return [
    ...additions.map((grant) =>
      waitingRow({
        id: grant.id,
        address: grant.address,
        line: WORDS.pendingLine(WORDS.pendingKind.addition, null, grant.effective_from),
        actor,
        consequence: WORDS.withdrawConsequence.addition,
        facts: [
          { label: ADDRESS, value: { record: grant.address } },
          { label: FACTS.effectiveFrom, value: instantOf(grant.effective_from) },
          { label: FACTS.mailTo, value: MAIL_TO.holdersAndPerson },
        ],
        act: removeAdministrator,
      }),
    ),
    ...(handover?.owner_from == null
      ? []
      : [
          waitingRow({
            id: handover.id,
            address: handover.address,
            line: WORDS.pendingLine(WORDS.pendingKind.handover, null, handover.owner_from),
            actor,
            consequence: WORDS.withdrawConsequence.handover,
            facts: [
              { label: FACTS.after, value: { record: handover.address } },
              { label: FACTS.effectiveFrom, value: instantOf(handover.owner_from) },
              { label: FACTS.mailTo, value: MAIL_TO.holders },
            ],
            act: stopHandover,
          }),
        ]),
    ...changes.map((change) =>
      waitingRow({
        id: change.id,
        address: change.address,
        line: WORDS.pendingLine(COPY.account.address.new, change.email, change.effective_from),
        actor,
        consequence: COPY.admin.addressChange.previousStays,
        facts: [
          { label: FACTS.before, value: { record: change.address } },
          { label: FACTS.after, value: { record: change.email } },
          { label: FACTS.effectiveFrom, value: instantOf(change.effective_from) },
          { label: FACTS.mailTo, value: MAIL_TO.holders },
        ],
        act: discardChange,
      }),
    ),
  ];
}

/** The head of the list of who holds access, its wait drawing a row's „Entfernen“ as most of the owner's rows hold it. */
const HEAD = {
  nameLabel: ADDRESS,
  columns: [{ key: "since", label: WORDS.since, narrow: true, width: "date" }],
  linked: false,
  acts: [COPY.shared.verb.remove],
} as const satisfies TableHead;

const EMPTY = { kind: "none", plural: ROUTES.adminAdministrators.title, glyph: "administrators" } as const;

/** A table of the page's cards, carrying nothing of `HEAD` a read table has no use for. */
const tableOf = (label: Copy, columns: TableProps["columns"], rows: readonly TableRow[]): TableProps => ({
  label,
  nameLabel: ADDRESS,
  columns,
  rows,
  empty: EMPTY,
});

/** „Aktiv“ open, and under it „Angekündigt“ folded with its count, drawn only while something waits. */
async function foldsOf(access: Promise<Access>) {
  const read = await access;
  const waiting = waitingRows(read);
  return (
    <ReadFolds
      column
      cards={[
        {
          title: COPY.admin.team.active,
          count: read.active.length,
          open: true,
          tables: [
            tableOf(
              ROUTES.adminAdministrators.title,
              HEAD.columns,
              read.active.map((grant) => activeRow(grant, read.actor)),
            ),
          ],
        },
        ...(waiting.length === 0
          ? []
          : [{ title: WORDS.pending, count: waiting.length, tables: [tableOf(WORDS.pending, [], waiting)] as const }]),
      ]}
    />
  );
}

/** The add dialog, for the owner alone. */
function addOf({ actor }: Access): ListCreate | null {
  if (actor === null) return null;
  return {
    title: actLabel(ADD),
    act: ADD,
    action: addAdministrator,
    touch: { holder: actor },
    consequence: WORDS.additionConsequence(ADDITION_WAIT),
    children: (
      <TextField
        label={ADDRESS}
        name="email"
        width="W3"
        kind="email"
        isRequired={GRANT_RULES.required.email}
        maxLength={GRANT_RULES.emailMax}
        description={COPY.shared.field.format(COPY.shared.field.exampleAddress)}
      />
    ),
  };
}

/** The handover's dialog, for the owner alone while an administrator stands to take over, and locked while one waits. */
function handoverOf({ actor, active, handover }: Access): ListCreate | null {
  const [owner, ...administrators] = active;
  if (actor === null || owner === undefined || administrators.length === 0) return null;
  return {
    title: actLabel(HAND_OVER),
    act: HAND_OVER,
    action: startHandover,
    touch: { holder: actor },
    ...(handover === undefined ? {} : { locked: WORDS.handoverRunning }),
    consequence: WORDS.handoverConsequence(OWNER_WAIT),
    facts: [
      { label: FACTS.before, value: { record: owner.address } },
      // Counted from this read: the press sets the date itself, and the row and the mail then state it.
      { label: FACTS.effectiveFrom, value: instantOf(new Date(now().getTime() + OWNER_WAIT.days * DAY_MS).toISOString()) },
      { label: FACTS.mailTo, value: MAIL_TO.holders },
    ],
    children: (
      <Select
        label={FACTS.after}
        name="grant_id"
        options={administrators.map((grant) => ({ id: grant.id, label: { record: grant.address } }))}
        isRequired={GRANT_RULES.required.grant_id}
      />
    ),
  };
}

/** Who holds access to the administration and what waits: the owner's acts on either, an administrator's page to read. */
export default function AdministratorsPage() {
  const access = readAccess();
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminAdministrators" } }}
      sideAct={{ label: actLabel(HAND_OVER), act: access.then(handoverOf) }}
      create={{ label: actLabel(ADD), act: access.then(addOf) }}
      list={{
        kind: "folds",
        wait: (
          <OpenFoldPlaceholder
            title={COPY.admin.team.active}
            head={HEAD}
            rows={3}
          />
        ),
        content: foldsOf(access),
      }}
    />
  );
}

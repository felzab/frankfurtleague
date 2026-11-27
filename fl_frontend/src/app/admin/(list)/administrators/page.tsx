import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { now } from "@/core/clock";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { asSignInIdentifier } from "@/core/emailAddress";
import { formatDate, formatInstantShort } from "@/core/format";
import { GRANT_WAIT, OWNER_WAIT } from "@/core/grant";
import { ROUTES } from "@/core/routes";
import { DAY_MS } from "@/core/timeUnits";
import { discardChange } from "@/features/address-change/actions";
import { getAddressChanges } from "@/features/address-change/queries";
import { getGrants } from "@/features/grants/queries";
import { actLabel } from "@/kit/dialogAct";
import { ListPage } from "@/kit/ListPage";
import { ReadFolds } from "@/kit/ReadFolds";
import { RowAct } from "@/kit/RowAct";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { pageMetadata } from "@/shared/utils/metadata";

import { addAdministrator, removeAdministrator, startHandover, stopHandover } from "./grantActs";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLAddressChangeAdminOpen, FLGrantRow } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { ListCreate } from "@/kit/ListPage";
import type { TableProps, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.administrators;
const FACTS = ADMIN_COPY.facts;
const MAIL_TO = ADMIN_COPY.mailTo;
const ADDRESS = COPY.shared.emailAddress;

const ADD = { verb: "enter", object: WORDS.object } as const;
const HAND_OVER = { verb: "handOver", object: COPY.shared.owner } as const;
const ADD_FACE = { title: actLabel(ADD), act: ADD, run: addAdministrator, rules: boxRulesOf(addAdministrator) } as const;
const HAND_OVER_FACE = { title: actLabel(HAND_OVER), act: HAND_OVER, run: startHandover, rules: boxRulesOf(startHandover) } as const;

export const metadata = pageMetadata(ROUTES.adminAdministrators);

/** A holder's address change in its wait, its date read. */
type WaitingChange = FLAddressChangeAdminOpen & { effective_from: string };

/** The grants as this reader sees them, and whether the reader holds the owner's grant, whose acts are the owner's alone. */
type Access = {
  /** The address the page was drawn for, which an act posts with its touch. */
  reader: string;
  readerIsOwner: boolean;
  /** Who holds access now, the owner first. */
  active: readonly FLGrantRow[];
  additions: readonly FLGrantRow[];
  handover: FLGrantRow | undefined;
  changes: readonly WaitingChange[];
};

/**
 * Who holds access and what waits. A future `effective_from` is an addition no session holds yet; a holder's change is
 * a running change the server marks a holder's with its date set, which it answers to the owner alone, and never the
 * reader's own, which Konto shows.
 */
async function readAccess(): Promise<Access> {
  const [{ grants }, { changes }, reader] = await Promise.all([getGrants(), getAddressChanges(), getAdminHolder()]);
  const moment = now().getTime();
  const inEffect = grants.filter((grant) => new Date(grant.effective_from).getTime() <= moment);
  const owner = inEffect.filter((grant) => grant.admin_tier === "owner");
  return {
    reader,
    readerIsOwner: owner.some((grant) => grant.address === asSignInIdentifier(reader)),
    active: [...owner, ...inEffect.filter((grant) => grant.admin_tier !== "owner")],
    additions: grants.filter((grant) => !inEffect.includes(grant)),
    handover: grants.find((grant) => grant.owner_from !== null),
    // Each answered anew with its date, which the compiler then types as set, where a filter would leave it nullable.
    changes: changes.flatMap(({ effective_from, ...change }) =>
      effective_from === null || change.holder === null ? [] : [{ ...change, effective_from }],
    ),
  };
}

const dayOf = (moment: string) => ({ record: formatDate(new Date(moment)) });

const instantOf = (moment: string) => ({ record: formatInstantShort(moment) });

/**
 * One grant in effect: its tier's chip, the owner's „Leitung“ setting its row apart from every administrator's
 * „Verwaltung“, and its removal, which the owner alone runs, on an administrator's row alone. The row opens nothing, so
 * on a phone its line says the day the „Seit“ column would.
 */
function activeRow(grant: FLGrantRow, { reader, readerIsOwner }: Pick<Access, "reader" | "readerIsOwner">): TableRow {
  const isOwner = grant.admin_tier === "owner";
  const locked = !readerIsOwner ? WORDS.ownerOnly : isOwner ? COPY.shared.afterHandover : undefined;
  return {
    id: grant.id,
    name: { record: grant.address, address: true },
    chip: { tone: "success", label: isOwner ? COPY.shared.owner : COPY.shared.administration },
    cells: { since: dayOf(grant.effective_from) },
    acts: (
      <RowAct
        verb="remove"
        subject={WORDS.object}
        consequence={WORDS.removeConsequence}
        facts={[
          { label: ADDRESS, value: { record: grant.address, address: true } },
          { label: WORDS.since, value: dayOf(grant.effective_from) },
          { label: FACTS.mailTo, value: MAIL_TO.holdersAndPerson },
        ]}
        run={removeAdministrator}
        id={grant.id}
        holder={reader}
        {...(locked === undefined ? {} : { locked })}
      />
    ),
  };
}

/** One waiting row: what waits and from when, and its withdrawal, which the owner alone runs. */
function waitingRow({
  id,
  address,
  line,
  reader,
  readerIsOwner,
  consequence,
  facts,
  act,
}: Pick<Access, "reader" | "readerIsOwner"> & {
  id: string;
  address: string;
  line: Copy;
  consequence: Copy;
  facts: ReadonlyArray<Fact>;
  act: (input: { id: string; holder: string }) => Promise<ActionAnswer>;
}): TableRow {
  return {
    id,
    name: { record: address, address: true },
    line,
    cells: {},
    acts: (
      <RowAct
        verb="withdraw"
        subject={COPY.shared.addressChange.change}
        consequence={consequence}
        facts={facts}
        run={act}
        id={id}
        holder={reader}
        {...(readerIsOwner ? {} : { locked: WORDS.ownerOnly })}
      />
    ),
  };
}

function waitingRows({ reader, readerIsOwner, additions, handover, changes }: Access): TableRow[] {
  return [
    ...additions.map((grant) =>
      waitingRow({
        id: grant.id,
        address: grant.address,
        line: WORDS.pendingLine(WORDS.pendingKind.addition, null, grant.effective_from),
        reader,
        readerIsOwner,
        consequence: WORDS.withdrawConsequence.addition,
        facts: [
          { label: ADDRESS, value: { record: grant.address, address: true } },
          { label: COPY.shared.facts.effectiveFrom, value: instantOf(grant.effective_from) },
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
            reader,
            readerIsOwner,
            consequence: WORDS.withdrawConsequence.handover,
            facts: [
              { label: COPY.shared.facts.after, value: { record: handover.address, address: true } },
              { label: COPY.shared.facts.effectiveFrom, value: instantOf(handover.owner_from) },
              { label: FACTS.mailTo, value: MAIL_TO.holders },
            ],
            act: stopHandover,
          }),
        ]),
    ...changes.map((change) =>
      waitingRow({
        id: change.id,
        address: change.address,
        line: WORDS.pendingLine(COPY.shared.addressChange.new, change.email, change.effective_from),
        reader,
        readerIsOwner,
        consequence: COPY.shared.addressChange.previousStays,
        facts: [
          { label: COPY.shared.facts.before, value: { record: change.address, address: true } },
          { label: COPY.shared.facts.after, value: { record: change.email, address: true } },
          { label: COPY.shared.facts.effectiveFrom, value: instantOf(change.effective_from) },
          { label: FACTS.mailTo, value: MAIL_TO.holders },
        ],
        act: discardChange,
      }),
    ),
  ];
}

/** The columns of the list of who holds access: on a phone a row's line stands for the „Seit“ column. */
const HEAD = {
  state: { label: WORDS.tier },
  columns: [{ key: "since", label: WORDS.since, hideOnPhone: true, onLine: "labelled", width: "date" }],
} as const satisfies Pick<TableProps, "columns" | "state">;

const EMPTY = { kind: "none", plural: ROUTES.adminAdministrators.title, glyph: "administrators" } as const;

/** A table of the page's cards, its rows named by their address. */
const tableOf = (label: Copy, head: Pick<TableProps, "columns" | "state" | "empty">, rows: readonly TableRow[]): TableProps => ({
  label,
  nameLabel: ADDRESS,
  ...head,
  rows,
});

/** „Aktiv“ open, and under it „Angekündigt“ folded with its count, which says „Nichts offen.“ while nothing waits. */
async function foldsOf(access: Promise<Access>) {
  const read = await access;
  const waiting = waitingRows(read);
  return (
    <ReadFolds
      column
      cards={[
        {
          title: COPY.shared.state.active,
          count: read.active.length,
          open: true,
          tables: [
            tableOf(
              ROUTES.adminAdministrators.title,
              { columns: HEAD.columns, state: HEAD.state, empty: EMPTY },
              read.active.map((grant) => activeRow(grant, read)),
            ),
          ],
        },
        {
          title: WORDS.pending,
          count: waiting.length,
          tables: [tableOf(WORDS.pending, { columns: [], empty: { kind: "clear" } }, waiting)],
        },
      ]}
    />
  );
}

/** The add dialog, the owner's alone: an administrator's button says so. */
function addOf({ reader, readerIsOwner }: Access): ListCreate {
  if (!readerIsOwner) return { ...ADD_FACE, children: null, locked: WORDS.ownerOnly };
  return {
    ...ADD_FACE,
    touch: { holder: reader },
    consequence: WORDS.additionConsequence(GRANT_WAIT),
    children: (
      <TextField
        label={ADDRESS}
        name="email"
        kind="email"
        description={COPY.shared.field.format(COPY.shared.field.exampleAddress)}
      />
    ),
  };
}

/**
 * The handover's dialog, the owner's alone and only while an administrator stands to take over, its button saying why
 * where it cannot run, and locked while one waits.
 */
function handoverOf({ reader, readerIsOwner, active, handover }: Access): ListCreate {
  const [owner, ...administrators] = active;
  // The reader holds the owner's grant in effect, which `active` sets first, so `owner` stands wherever the reader may act.
  if (!readerIsOwner || owner === undefined) return { ...HAND_OVER_FACE, children: null, locked: WORDS.ownerOnly };
  if (administrators.length === 0) return { ...HAND_OVER_FACE, children: null, locked: WORDS.noAdministrator };
  return {
    ...HAND_OVER_FACE,
    touch: { holder: reader },
    ...(handover === undefined ? {} : { locked: WORDS.handoverRunning }),
    consequence: WORDS.handoverConsequence(OWNER_WAIT),
    facts: [
      { label: COPY.shared.facts.before, value: { record: owner.address, address: true } },
      // Counted from this read: the press sets the date itself, and the row and the mail then state it.
      { label: COPY.shared.facts.effectiveFrom, value: instantOf(new Date(now().getTime() + OWNER_WAIT.days * DAY_MS).toISOString()) },
      { label: FACTS.mailTo, value: MAIL_TO.holders },
    ],
    children: (
      <Select
        label={COPY.shared.facts.after}
        name="grant_id"
        options={administrators.map((grant) => ({ id: grant.id, label: { record: grant.address } }))}
      />
    ),
  };
}

/**
 * Who holds access to the administration and what waits, and the owner's acts on either, which an administrator sees
 * locked with their reason, so every reader's page stands in one shape.
 */
export default function AdministratorsPage() {
  const access = readAccess();
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminAdministrators" } }}
      side={access.then(handoverOf)}
      create={access.then(addOf)}
      list={{ kind: "drawn", content: foldsOf(access) }}
    />
  );
}

import { boxRulesOf } from "@/core/action";
import { ADDRESS_CHANGE_WAITING_PERIOD } from "@/core/addressChange";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { formatInstantShort } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getAddressChanges } from "@/features/address-change/queries";
import { deliveryChip } from "@/features/bewerbungen/deliveryState";
import { ListPage } from "@/kit/ListPage";
import { EXPIRED_CHIP } from "@/kit/stateChips";
import { pageMetadata } from "@/shared/utils/metadata";

import { startLostMailboxChange } from "./addressChangeActs";
import { ChangeActs } from "./ChangeActs";
import { StartFields } from "./StartFields";

import type { FLAddressChangeAdminOpen, FLAddressChangeWaitsOn } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Fact } from "@/kit/Facts";
import type { ListCreate } from "@/kit/ListPage";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.addressChange;

const START = COPY.shared.withObject(COPY.shared.addressChange.change, "enter");

export const metadata = pageMetadata(ROUTES.adminAddressChanges);

/** The running changes, and the address the page is drawn for: one read for the list and the toolbar's act alike. */
async function readChanges() {
  const [{ changes }, holder] = await Promise.all([getAddressChanges(), getAdminHolder()]);
  return { changes, holder };
}

const WAITS_ON_TONE: Readonly<Record<FLAddressChangeWaitsOn, ChipProps["tone"]>> = {
  previous_address: "warn",
  new_address: "warn",
  waiting_period: "info",
};

/** What the change waits on, or that the step it waited on lapsed, which the hourly pass ends. */
const chipOf = ({ expired, waits_on }: FLAddressChangeAdminOpen): ChipProps =>
  expired ? EXPIRED_CHIP : { tone: WAITS_ON_TONE[waits_on], label: WORDS.waitsOn[waits_on] };

/** The moment the row's step ends, where it has one: the wait's, once it runs, else the open link's. */
function untilOf({ effective_from, valid_until, waits_on }: FLAddressChangeAdminOpen) {
  if (waits_on === "waiting_period" && effective_from !== null) return WORDS.from(effective_from);
  return valid_until === null ? undefined : WORDS.until(valid_until);
}

/**
 * The ending's facts: a holder's change in its wait has told every holder, who hear of its end; nothing else is mailed,
 * and the question then names no mail, as every question mailing nobody leaves the row out.
 */
function endFactsOf({ address, email, effective_from, holder, waits_on }: FLAddressChangeAdminOpen): ReadonlyArray<Fact> {
  const toldHolders = holder !== null && waits_on === "waiting_period";
  return [
    { label: COPY.shared.facts.before, value: { record: address, address: true } },
    { label: COPY.shared.facts.after, value: { record: email, address: true } },
    ...(effective_from === null ? [] : [{ label: COPY.shared.facts.effectiveFrom, value: { record: formatInstantShort(effective_from) } }]),
    ...(toldHolders ? [{ label: ADMIN_COPY.facts.mailTo, value: ADMIN_COPY.mailTo.holders }] : []),
  ];
}

/**
 * One running change, which opens no page: its address on file, its state, and whatever its last mail met. When its
 * step ends stands on the row's muted line, as a waiting change's does on Administratoren: a column for it would leave
 * the two addresses too little of a 42-rem table beside the two chips. A stacked row, which leaves the „Neu“ column
 * out, names the new address on that line before the moment, the address breaking after its „@“ as every one does.
 */
function rowOf(change: FLAddressChangeAdminOpen, holder: string): TableRow {
  const delivery = deliveryChip(change.delivery);
  const until = untilOf(change);
  // A fresh link serves only the step that waits on the new mailbox.
  const resends = change.waits_on === "new_address";
  return {
    id: change.id,
    name: { record: change.address, address: true },
    chip: chipOf(change),
    ...(delivery === null ? {} : { delivery }),
    ...(until === undefined ? {} : { line: until }),
    cells: { after: { record: change.email, address: true } },
    acts: (
      <ChangeActs
        id={change.id}
        resends={resends}
        verb={change.waits_on === "waiting_period" ? "withdraw" : "discard"}
        facts={endFactsOf(change)}
        holder={holder}
      />
    ),
  };
}

/**
 * The table's head. A row carries its ending, and a fresh link before it while the change waits on the new mailbox,
 * each its labelled button in a wide box and an entry of the row's „⋯“ in a narrow one. The new address is a column
 * holding an address, cut at an address's step as every list's is. The muted line under a row's name is the moment its
 * step ends in the table, where it has one, and the new address before it on a stacked row.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.facts.before,
  state: { label: COPY.shared.facts.state, delivery: true },
  columns: [{ key: "after", label: COPY.shared.facts.after, hideOnPhone: true, onLine: "labelled", width: "line", cut: true }],
};

/**
 * Adressänderungen: the running changes, a lost-mailbox change started over the list. A holder's change stands here for
 * the owner alone, as the server answers it; an administrator's own never does.
 */
export default function AddressChangesPage() {
  const read = readChanges();
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminAddressChanges" } }}
      create={read.then(({ changes, holder }): ListCreate => ({
        title: START,
        act: { verb: "enter", object: COPY.shared.addressChange.change },
        run: startLostMailboxChange,
        rules: boxRulesOf(startLostMailboxChange),
        consequence: WORDS.startConsequence(ADDRESS_CHANGE_WAITING_PERIOD),
        facts: [{ label: ADMIN_COPY.facts.mailTo, value: ADMIN_COPY.mailTo.bothAddresses }],
        touch: { holder },
        children: <StartFields running={changes.map(({ address }) => address)} />,
      }))}
      list={{
        kind: "table",
        head: HEAD,
        content: read.then(({ changes, holder }) => ({
          table: {
            label: ROUTES.adminAddressChanges.title,
            rows: changes.map((change) => rowOf(change, holder)),
            empty: { kind: "none", plural: ROUTES.adminAddressChanges.title, glyph: "email" } as const,
          },
        })),
      }}
    />
  );
}

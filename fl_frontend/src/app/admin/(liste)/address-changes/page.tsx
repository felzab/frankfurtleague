import { ListPage } from "@/kit/ListPage";

import { requires } from "@/core/action";
import { ADDRESS_CHANGE_WAIT_DAYS } from "@/core/addressChange";
import { getAdminSession } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { formatInstantShort } from "@/core/format";
import { addressChangePostAddressChangeAdminBodyAddressMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { getAddressChanges } from "@/features/address-change/queries";
import { SignInAddressSchema, SignInPayloadSchema } from "@/features/auth/schemas";
import { deliveryChip } from "@/features/bewerbungen/deliveryState";
import { pageMetadata } from "@/shared/utils/metadata";

import { startLostMailboxChange } from "./addressChangeActs";
import { ChangeActs } from "./ChangeActs";
import { StartFields } from "./StartFields";

import type { FLAddressChangeAdminOpen, FLAddressChangeWaitsOn } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Fact } from "@/kit/Facts";
import type { ListCreate } from "@/kit/ListPage";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";
import type { StartRules } from "./StartFields";

const WORDS = COPY.admin.addressChange;

const START = COPY.shared.withObject(COPY.account.address.change, "enter");

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminAddressChanges, ROUTES.adminAddressChanges.path());
}

/** The running changes, and the address the page is drawn for: one read for the list and the toolbar's act alike. */
async function readChanges() {
  const [{ changes }, session] = await Promise.all([getAddressChanges(), getAdminSession()]);
  // The page's read turned a refused session away to the sign-in before this line; an acting administrator signs in by
  // passkey alone, so every act here asks the touch.
  return { changes, holder: session?.user.email ?? "" };
}

const WAITS_ON_TONE: Readonly<Record<FLAddressChangeWaitsOn, ChipProps["tone"]>> = {
  previous_address: "warn",
  new_address: "warn",
  waiting_period: "info",
};

/** What the change waits on, or that the step it waited on lapsed, which the hourly pass ends. */
const chipOf = ({ expired, waits_on }: FLAddressChangeAdminOpen): ChipProps =>
  expired ? { tone: "neutral", label: COPY.admin.expired } : { tone: WAITS_ON_TONE[waits_on], label: WORDS.waitsOn[waits_on] };

/** The moment the row's step ends, where it has one: the wait's, once it runs, else the open link's. */
function untilOf({ effective_from, valid_until, waits_on }: FLAddressChangeAdminOpen) {
  if (waits_on === "waiting_period" && effective_from !== null) return WORDS.from(effective_from);
  return valid_until === null ? undefined : WORDS.until(valid_until);
}

/** The ending's facts: a holder's change in its wait has told every holder, who hear of its end; nothing else is mailed. */
function endFactsOf({ address, email, effective_from, holder, waits_on }: FLAddressChangeAdminOpen): ReadonlyArray<Fact> {
  const toldHolders = holder !== null && waits_on === "waiting_period";
  return [
    { label: COPY.admin.facts.before, value: { record: address, address: true } },
    { label: COPY.admin.facts.after, value: { record: email, address: true } },
    ...(effective_from === null ? [] : [{ label: COPY.admin.facts.effectiveFrom, value: { record: formatInstantShort(effective_from) } }]),
    { label: COPY.admin.facts.mailTo, value: toldHolders ? COPY.admin.mailTo.holders : COPY.admin.seatEmpty },
  ];
}

/**
 * One running change, which opens no page: its address on file, its state, and whatever its last mail met. When its
 * step ends stands on the row's muted line, as a waiting change's does on Administratoren: a column for it would leave
 * the two addresses too little of a 42-rem table beside the two chips.
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
    cells: { after: { record: change.email } },
    // The fresh link before the ending, as `ChangeActs` draws them, both from `resends`.
    sideActs: resends ? 2 : 1,
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
 * The table's head, drawn while the rows are read and over them once they are. A row carries its ending, and a fresh
 * link before it while the change waits on the new mailbox: where some row carries both, every row's stand in its „⋯“,
 * and else each row's ending is its button, which the wait draws, the taller of the two. The new address is a column
 * holding an address, cut at an address's step as every list's is.
 */
const HEAD: TableHead = {
  nameLabel: COPY.admin.facts.before,
  state: { label: COPY.admin.schiedsrichter.state, delivery: true },
  acts: [COPY.shared.verb.discard],
  columns: [{ key: "after", label: COPY.admin.facts.after, hideOnPhone: true, width: "line", cut: true }],
};

const START_RULES: StartRules = {
  required: {
    address: requires(SignInPayloadSchema.shape.email, ""),
    email: requires(SignInAddressSchema, ""),
  },
  addressMax: addressChangePostAddressChangeAdminBodyAddressMax,
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
      create={{
        label: START,
        act: read.then(({ changes, holder }): ListCreate => ({
          title: START,
          act: { verb: "enter", object: COPY.account.address.change },
          action: startLostMailboxChange,
          consequence: WORDS.startConsequence({ days: ADDRESS_CHANGE_WAIT_DAYS }),
          facts: [{ label: COPY.admin.facts.mailTo, value: COPY.admin.mailTo.bothAddresses }],
          touch: { holder },
          children: (
            <StartFields
              running={changes.map(({ address }) => address)}
              rules={START_RULES}
            />
          ),
        })),
      }}
      list={{
        kind: "table",
        head: HEAD,
        wait: 3,
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

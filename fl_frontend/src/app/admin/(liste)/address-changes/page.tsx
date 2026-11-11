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

/** The moment the row's step ends: the wait's, once it runs, else the open link's. */
function untilOf({ effective_from, valid_until, waits_on }: FLAddressChangeAdminOpen) {
  if (waits_on === "waiting_period" && effective_from !== null) return WORDS.fromCell(effective_from);
  return valid_until === null ? COPY.shared.noValue : WORDS.untilCell(valid_until);
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

/** One running change, which opens no page: its address on file, its state, and whatever its last mail met. */
function rowOf(change: FLAddressChangeAdminOpen, holder: string): TableRow {
  const delivery = deliveryChip(change.delivery);
  return {
    id: change.id,
    name: { record: change.address, address: true },
    chip: chipOf(change),
    ...(delivery === null ? {} : { delivery }),
    cells: { after: { record: change.email }, until: untilOf(change) },
    acts: (
      <ChangeActs
        id={change.id}
        resends={change.waits_on === "new_address"}
        verb={change.waits_on === "waiting_period" ? "withdraw" : "discard"}
        facts={endFactsOf(change)}
        holder={holder}
      />
    ),
  };
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.admin.facts.before,
  columns: [
    // Cut at an instant's least width, not an address line's: beside the open rail at 1024 px the row's acts stay in view.
    { key: "after", label: COPY.admin.facts.after, hideOnPhone: true, width: "instant", cut: true },
    { key: "until", label: WORDS.until, width: "instant" },
  ],
  acts: [COPY.shared.withObject(COPY.account.address.link, "send"), COPY.shared.verb.discard],
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

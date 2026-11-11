"use client";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Menu } from "./Menu";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { MenuEntry } from "./Menu";

/** One side act of a row: its menu entry's words, and what its press does. */
export type SideAct = {
  label: Copy;
  /**
   * An act that destroys: its entry in the danger hue (`Menu`'s `tone`), as its button would stand in the outlined
   * danger look, while it can run; a locked one is muted as every locked entry is.
   */
  tone?: "danger";
  /** The act is under way: the „⋯“ that holds it is busy. */
  isBusy?: boolean;
  /**
   * Why the act cannot run on the record as it stands: its entry muted, reachable and saying why (`Menu`'s locked
   * entry); `onPress` is never called.
   */
  locked?: Copy;
  /**
   * Runs the act, or opens its question or its dialog. A press on the entry calls it in the press's own event, so an
   * act behind the passkey touch asks it from that press.
   */
  onPress: () => void;
};

const entryOf = ({ label, tone, locked, onPress }: SideAct): MenuEntry =>
  locked === undefined
    ? { kind: "action", label, ...(tone === undefined ? {} : { tone }), onAction: onPress }
    : { kind: "locked", label, reason: locked };

/**
 * A row's side acts, the ones beside what the row is for, such as a running change's fresh link and its ending or a
 * seat's link and its edit, in a list whose rows carry two or more: one „⋯“ at the row's end, at every width, which
 * opens the kit's menu on the acts in their order, a destroying one after the others, each entry its words alone, as
 * every menu of the kit's holds them. The list decides, never the row:
 * every row of it that carries acts holds them in the „⋯“, one holding a single act too, so the rows of one list stand
 * alike. A list whose rows carry one side act at the most shows that act as its button, and a row's decision, such as
 * „Zusagen“ and „Ablehnen“, keeps its labelled buttons: neither is drawn here.
 *
 * The „⋯“ is described by its row's name, as every button repeated down a list is (`RowActs`). `children` are the
 * questions and dialogs the acts open, each on the open state its act's press sets: one opened from the menu hands the
 * focus back to the „⋯“ as it closes, as the menu itself does.
 */
export function SideActs({ acts, children }: { acts: ReadonlyArray<SideAct>; children?: ReactNode }) {
  return (
    <>
      <Menu
        label={COPY.template.more}
        placement="below"
        align="end"
        trigger={
          <Button
            icon="more"
            label={COPY.template.more}
            isBusy={acts.some((act) => act.isBusy === true)}
          />
        }
        groups={[acts.map(entryOf)]}
      />
      {children}
    </>
  );
}

"use client";

import { createContext, use } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { Menu } from "./Menu";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { MenuEntry } from "./Menu";

/** One side act of a row: its words, its button's and its menu entry's alike, and what its press does. */
export type SideAct = {
  label: Copy;
  /**
   * An act that destroys: its button in the outlined danger look every destroying act's trigger takes, and its menu
   * entry in the same danger hue (`Menu`'s `tone`), while it can run; a locked one is muted as every locked entry is.
   */
  tone?: "danger";
  /** The act is under way: its button busy, or the „⋯“ that holds it. */
  isBusy?: boolean;
  /**
   * Why the act cannot run on the record as it stands: its button dimmed, reachable and saying why (`Button`'s
   * `locked`), and its menu entry the same (`Menu`'s locked entry); `onPress` is never called.
   */
  locked?: Copy;
  /**
   * Runs the act, or opens its question or its dialog. A press on the button or on the menu's entry calls it in the
   * press's own event, so an act behind the passkey touch asks it from that press.
   */
  onPress: () => void;
};

/** Whether the list a row stands in folds its rows' side acts, which it decides once for all its rows. */
const ListFolds = createContext(true);

/**
 * What a list hands its rows' side acts: whether it folds them, `true` where some row of it carries two or more, as
 * each row says (`Table`'s and `SeatRows`' `sideActs`). A client part, since a list may be drawn on the server, where
 * no context is given.
 */
export function SideActsScope({ folds, children }: { folds: boolean; children: ReactNode }) {
  return <ListFolds value={folds}>{children}</ListFolds>;
}

const entryOf = ({ label, tone, locked, onPress }: SideAct): MenuEntry =>
  locked === undefined
    ? { kind: "action", label, ...(tone === undefined ? {} : { tone }), onAction: onPress }
    : { kind: "locked", label, reason: locked };

/**
 * A row's side acts, the ones beside what the row is for, such as a running change's fresh link and its ending or a
 * seat's link and its edit. The list decides their form, never the row, so the rows of one list stand alike: a list
 * whose rows carry two or more holds every row's in one „⋯“ at the row's end, at every width, one holding a single act
 * too, which opens the kit's menu on the acts in their order, a destroying one after the others, each entry its words
 * alone, as every menu of the kit's holds them; a list whose rows carry one at the most shows that act as its labelled
 * button, a destroying one in the outlined danger look, as every lone act's is. Two acts are never two buttons: a row
 * holding more than its list was told folds them all the same. A row's decision, such as „Zusagen“ and „Ablehnen“, keeps
 * its labelled buttons and is never drawn here.
 *
 * `children` are the questions and dialogs the acts open, each on the open state its act's press sets: one opened from
 * the menu hands the focus back to the „⋯“ as it closes, as the menu itself does.
 */
export function SideActs({ acts, children }: { acts: ReadonlyArray<SideAct>; children?: ReactNode }) {
  const [only] = acts;
  const lone = !use(ListFolds) && acts.length === 1 ? only : undefined;
  return (
    <>
      {lone === undefined ? (
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
      ) : (
        <Button
          variant={askingLook(lone.tone ?? "primary")}
          label={lone.label}
          isBusy={lone.isBusy}
          locked={lone.locked}
          onPress={lone.onPress}
        />
      )}
      {children}
    </>
  );
}

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
   * `locked`), and its menu entry the same, the reason the line under its words (`Menu`'s locked entry); `onPress` is
   * never called.
   */
  locked?: Copy;
  /**
   * Runs the act, or opens its question or its dialog. A press on the button or on the menu's entry calls it in the
   * press's own event, so an act behind the passkey touch asks it from that press.
   */
  onPress: () => void;
};

/**
 * Whether the list a row stands in folds its rows' side acts at every width, which it decides once for all its rows.
 * A row outside any list folds them.
 */
const ListFolds = createContext(true);

/**
 * What a list hands its rows' side acts: whether it folds them at every width, `true` where some row of it carries
 * three or more, as each row says (`Table`'s and `SeatRows`' `sideActs`). A client part, since a list may be drawn on
 * the server, where no context is given.
 */
export function SideActsScope({ folds, children }: { folds: boolean; children: ReactNode }) {
  return <ListFolds value={folds}>{children}</ListFolds>;
}

const entryOf = ({ label, tone, locked, onPress }: SideAct): MenuEntry =>
  locked === undefined
    ? { kind: "action", label, ...(tone === undefined ? {} : { tone }), onAction: onPress }
    : { kind: "locked", label, reason: locked };

/**
 * The two forms a list's box picks between, by its own width as the table's rows are (`Table`'s `stacks`): each form
 * is drawn and one shows, as a table's chips are drawn on the name's line and in the status column. A form's wrapper
 * gives way to its parts, so the buttons stand in the row's line of acts as its own items would.
 */
const WIDE_CLASSES = "contents @max-2xl:hidden";
const NARROW_CLASSES = "contents @2xl:hidden";

/**
 * A row's side acts, the ones beside what the row is for, such as a running change's fresh link and its ending or a
 * seat's link and its edit. The list decides their form, never the row, so the rows of one list stand alike. In a box
 * of 42 rem or more, a table's, each act is its labelled button, a destroying one in the outlined danger look and a
 * locked one dimmed, saying why on hover, focus and press (`Button`'s `locked`). In a narrower box, a phone's, every
 * row's acts fold into one „⋯“ at the row's end, which opens the kit's menu on the acts in their order, a destroying
 * one after the others, each entry its words alone, and a locked one dimmed with its reason as the line under it. A
 * list some row of which carries three or more folds at every width, since a row holds at most two buttons beside its
 * words. A row's decision, such as „Zusagen“ and „Ablehnen“, keeps its labelled buttons and is never drawn here.
 *
 * `children` are the questions and dialogs the acts open, each on the open state its act's press sets: one opened from
 * the menu hands the focus back to the „⋯“ as it closes, as the menu itself does.
 */
export function SideActs({ acts, children }: { acts: ReadonlyArray<SideAct>; children?: ReactNode }) {
  const menu = (
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
  );
  return (
    <>
      {use(ListFolds) ? (
        menu
      ) : (
        <>
          <span className={WIDE_CLASSES}>
            {acts.map((act) => (
              <Button
                key={act.label}
                variant={askingLook(act.tone ?? "primary")}
                label={act.label}
                isBusy={act.isBusy}
                locked={act.locked}
                onPress={act.onPress}
              />
            ))}
          </span>
          <span className={NARROW_CLASSES}>{menu}</span>
        </>
      )}
      {children}
    </>
  );
}

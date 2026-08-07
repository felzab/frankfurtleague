/**
 * ADMIN · navigation structure
 *
 * The admin sidemenu, and the icon dictionary it is validated against. Kept in one file precisely so
 * the two cannot disagree.
 */

import { ExclamationShape, Magnifier, MapPin, Medal, Person } from "@gravity-ui/icons";

import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * The icon dictionary lives beside the structure it must agree with, and `AdminIconName` is derived
 * from it — so an `iconName` typo below is a compile error instead of a nav item that silently
 * renders without an icon.
 */
export const ADMIN_SIDEMENU_ICONS = {
  ExclamationShape,
  Magnifier,
  Medal,
  Person,
  MapPin,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  {
    category_name: "Spiele",
    sub_options: [
      // "Handlungsbedarf", not "Übersicht": the page is a queue of the things needing an admin, ranked
      // by what each one blocks (ADR-0056) — an overview is what `spielsuche` below is. The label is
      // also the collapsed sidemenu's tooltip and the page's own `h1`, so all three move together.
      { id: "action_required", label: "Handlungsbedarf", iconName: "ExclamationShape" },
      // Below the queue and above the search box, which is the order the three are reached in: what
      // needs doing, then the draw that decides what will need doing, then looking one fixture up.
      // Named AND iconed for the public bracket's own entry (`DASHBOARD_SIDEMENU_ICONS`), because it
      // is the same rounds seen for a different purpose — a second word and a second glyph for one
      // stage are two more things to learn for nothing.
      { id: "finalrunden", label: "Finalrunden", iconName: "Medal" },
      { id: "spielsuche", label: "Spielsuche", iconName: "Magnifier" },
    ],
  },

  {
    category_name: "Infrastruktur",
    sub_options: [{ id: "spielorte", label: "Spielorte", iconName: "MapPin" }],
  },
  {
    category_name: "Beteiligte",
    sub_options: [{ id: "schiedsrichter", label: "Schiedsrichter", iconName: "Person" }],
  },
];

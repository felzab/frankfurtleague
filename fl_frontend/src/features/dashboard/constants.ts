import { Calendar, ClockArrowRotateLeft, LayoutHeaderCells, Magnifier, Medal, Person, Persons } from "@gravity-ui/icons";

import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * The icon dictionary lives beside the structure it must agree with, and `DashboardIconName` is
 * derived from it — so an `iconName` typo below is a compile error instead of a nav item that
 * silently renders without an icon.
 */
export const DASHBOARD_SIDEMENU_ICONS = {
  Magnifier,
  ClockArrowRotateLeft,
  Calendar,
  Medal,
  LayoutHeaderCells,
  Persons,
  Person,
} as const satisfies Record<string, React.ElementType>;

export type DashboardIconName = keyof typeof DASHBOARD_SIDEMENU_ICONS;

export const DASHBOARD_SIDEMENU_STRUCTURE: SidemenuStructure<DashboardIconName> = [
  {
    category_name: "Spiele",
    sub_options: [
      { id: "spielsuche", label: "Spielsuche", iconName: "Magnifier" },
      { id: "spielhistorie", label: "Spielhistorie", iconName: "ClockArrowRotateLeft" },
      { id: "spielplan", label: "Spielplan", iconName: "Calendar" },
      { id: "playoffs", label: "Finalrunden", iconName: "Medal" },
    ],
  },
  {
    category_name: "Tabellen",
    sub_options: [{ id: "saisontabelle", label: "Saisontabelle", iconName: "LayoutHeaderCells" }],
  },
  {
    category_name: "Teams",
    sub_options: [
      { id: "teams", label: "Teams", iconName: "Persons" },
      { id: "spieler", label: "Spieler", iconName: "Person" },
    ],
  },
];

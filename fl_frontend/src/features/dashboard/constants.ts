import type { SidemenuStructure } from "@/shared/types/types";

export const DASHBOARD_SIDEMENU_STRUCTURE: SidemenuStructure = [
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

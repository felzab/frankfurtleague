import type { SidemenuStructure } from "@/shared/types";

export const DASHBOARD_SIDEMENU_STRUCTURE: SidemenuStructure = [
  {
    category_name: "Spiele",
    sub_options: [
      { id: "spielsuche", label: "Spielsuche" },
      { id: "spielhistorie", label: "Spielhistorie" },
      { id: "spielplan", label: "Spielplan" },
      { id: "playoffs", label: "Finalrunden" },
    ],
  },
  {
    category_name: "Tabellen",
    sub_options: [{ id: "saisontabelle", label: "Saisontabelle" }],
  },
  {
    category_name: "Teams",
    sub_options: [
      { id: "teams", label: "Teams" },
      { id: "spieler", label: "Spieler" },
    ],
  },
];

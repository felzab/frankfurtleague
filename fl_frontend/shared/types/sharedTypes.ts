export interface SidemenuStructureSubOption {
  id: string;
  label: string;
}

export interface SidemenuStructureEntry {
  category_name: string;
  sub_options: SidemenuStructureSubOption[];
}

export type SidemenuStructure = SidemenuStructureEntry[];

export type FormState = {
  message?: string;
  success: boolean;
  error?: string;
} | null;

export interface FLAddress {
  strasse: string;
  hausnummer: string;
  plz: string;
  stadtteil: string;
  stadt: string;
}

export interface FLKontakt {
  telefon: string | null;
  email: string | null;
}

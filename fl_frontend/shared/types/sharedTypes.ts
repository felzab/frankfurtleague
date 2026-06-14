export interface SidemenuStructureSubOption {
  id: string;
  label: string;
}

export interface SidemenuStructureEntry {
  category_name: string;
  sub_options: SidemenuStructureSubOption[];
}

export type SidemenuStructure = SidemenuStructureEntry[];

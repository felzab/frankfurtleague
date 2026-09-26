import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";

/**
 * The team shell's season slot: the season the address carries, and never a selector, since a team's
 * area is one season's by its address. No season list is read for it.
 */
export function SaisonChipSlot({ saisonId, isLaufend }: { saisonId: string; isLaufend: boolean }) {
  return <SaisonChip isLaufend={isLaufend}>Saison {saisonId}</SaisonChip>;
}

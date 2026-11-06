import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";

/**
 * The team shell's season slot: the season the address carries, and never a selector, since a team's
 * area is one season's by its address. No season list is read for it.
 */
export function SaisonChipSlot({ saisonId, isRunning }: { saisonId: string; isRunning: boolean }) {
  return <SaisonChip isRunning={isRunning}>Saison {saisonId}</SaisonChip>;
}

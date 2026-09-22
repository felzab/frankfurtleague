"use client";

import { useState } from "react";

import { signOutAction } from "@/features/auth/actions";
import { PasskeyModal } from "@/features/passkeys/components/modals/PasskeyModal";
import { AppShell } from "@/shared/components/layout/shell/AppShell";

import { ADMIN_SHELL_FALLBACK, ADMIN_SHELL_UNLISTED_SECTIONS, ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../../constants";

import type React from "react";

/**
 * A client wrapper rather than the layout calling `AppShell` directly: `shared` may not import from
 * `features`, so the sign-out action is injected here. Its presence is also the gate — the dashboard
 * shell passes none and renders no sign-out item.
 */
export function AdminShell({ saisonMetadataDisplay, children }: { saisonMetadataDisplay: React.ReactNode; children: React.ReactNode }) {
  const [isPasskeyModalOpen, setIsPasskeyModalOpen] = useState(false);

  return (
    <>
      <AppShell
        structure={ADMIN_SIDEMENU_STRUCTURE}
        linkPrefix="/admin"
        iconDictionary={ADMIN_SIDEMENU_ICONS}
        saisonMetadataDisplay={saisonMetadataDisplay}
        unlistedSections={ADMIN_SHELL_UNLISTED_SECTIONS}
        fallbackTitle={ADMIN_SHELL_FALLBACK.label}
        fallbackHint={ADMIN_SHELL_FALLBACK.hint}
        onSignOut={signOutAction}
        onManagePasskeys={() => setIsPasskeyModalOpen(true)}>
        {children}
      </AppShell>

      {/* Outside `AppShell` rather than in the menu that opens it: the drop-up's popover portals and
          unmounts on close, taking any overlay declared inside it with the press that opened one. */}
      <PasskeyModal
        isOpen={isPasskeyModalOpen}
        onClose={() => setIsPasskeyModalOpen(false)}
      />
    </>
  );
}

"use client";

import { KONTO_HREF } from "@/core/kontoHref";
import { signOutAction } from "@/features/auth/actions";
import { AppShell } from "@/shared/components/layout/shell/AppShell";

import { ADMIN_SHELL_FALLBACK, ADMIN_SHELL_UNLISTED_SECTIONS, ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../../constants";

import type React from "react";

/**
 * A client wrapper rather than the layout calling `AppShell` directly: `shared` may not import from
 * `features`, so the sign-out action is injected here. Its presence is also the gate — the dashboard
 * shell passes none and renders no sign-out item.
 */
export function AdminShell({
  saisonMetadataDisplay,
  funktionSwitcher,
  children,
}: {
  saisonMetadataDisplay: React.ReactNode;
  /** Streamed in under the admin guard by the layout, as the season slot is. */
  funktionSwitcher: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      structure={ADMIN_SIDEMENU_STRUCTURE}
      // eslint-disable-next-line local/admin-link -- the sidemenu's link prefix; SidemenuNavLinksWithSaisonQuery appends the season to each entry it builds
      linkPrefix="/bereich/admin"
      keepsSaisonQuery
      iconDictionary={ADMIN_SIDEMENU_ICONS}
      saisonMetadataDisplay={saisonMetadataDisplay}
      funktionSwitcher={funktionSwitcher}
      unlistedSections={ADMIN_SHELL_UNLISTED_SECTIONS}
      fallbackTitle={ADMIN_SHELL_FALLBACK.label}
      fallbackHint={ADMIN_SHELL_FALLBACK.hint}
      kontoHref={KONTO_HREF}
      onSignOut={signOutAction}>
      {children}
    </AppShell>
  );
}

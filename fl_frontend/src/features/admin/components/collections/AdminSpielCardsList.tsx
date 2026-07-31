"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";

import { useAdmin } from "../providers/AdminContextProvider";

import type { FLSpiel } from "@/features/spiele/schemas";

/** One import specifier, used by both the lazy component and the idle preload below. */
const importEditModal = () => import("@/features/spiele/components/modals/AdminEditSpielDataModal");

/**
 * Shown only if the chunk is genuinely slow to arrive.
 *
 * `delay-300 fill-mode-both` is the whole trick: `fill-mode: both` applies the `enter` keyframe's
 * starting state during the delay, and `fade-in` makes that state `opacity: 0` — so this renders
 * nothing at all for 300 ms and then fades in. On the normal path (chunk preloaded, modal opens in a
 * few ms) it is never seen, which is what keeps a loading state from becoming a flash. Verified in
 * the built CSS: `delay-300` emits two rules, Tailwind core's `transition-delay` and
 * `tw-animate-css`'s `animation-delay`. Different properties, so both apply and the animation
 * delay is the real one.
 */
function EditModalLoading() {
  return (
    <div
      role="status"
      aria-label="Bearbeitungsformular wird geladen"
      className="animate-in fade-in fill-mode-both fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm delay-300 duration-150">
      <div className="bg-surface flex items-center gap-x-1.5 rounded-2xl px-6 py-5 shadow-lg">
        <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.4s]" />
        <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.2s]" />
        <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full" />
      </div>
    </div>
  );
}

// `loading` is not decoration here. Without it `dynamic({ ssr: false })` still creates a Suspense
// boundary but its fallback renders `null` (Next's `lazy-dynamic/loadable.js`), so a click on a cold
// chunk looked completely dead — no backdrop, no spinner, nothing — until the chunk resolved.
const AdminEditSpielDataModal = dynamic(importEditModal, { ssr: false, loading: EditModalLoading });

export default function AdminSpielCardsList({ spiele, today }: { spiele: FLSpiel[]; today: string }) {
  const [selectedAdminSpiel, setSelectedAdminSpiel] = useState<FLSpiel | null>(null);

  // Fetch the editor's chunk once this list is on screen, so the first click does not pay for it.
  // It is a big chunk — the whole of `@internationalized/date`, HeroUI's Calendar/DatePicker/
  // TimeField and three Autocompletes live in it and nothing else in the app pulls them — which is
  // why the first open was noticeably slow (NEW-R4).
  // In an effect, so it starts after this page has painted: it is off the critical path and cannot
  // delay the route's own load. Kept lazy rather than imported statically because that would put all
  // of the above back into the initial admin bundle, which is the one thing `dynamic()` is here to
  // prevent. Opening a match editor is the primary action on these routes, so the fetch is rarely
  // wasted.
  useEffect(() => {
    void importEditModal();
  }, []);

  // Read here rather than inside the form: the lists are admin's to aggregate, and the form lives
  // in `spiele`, which must not depend on `admin`.
  const { teams, spielorte, schiedsrichter } = useAdmin();

  return (
    <div className="contents">
      <SpielCardsList
        spiele={spiele}
        today={today}
        onAdminEdit={(spiel) => setSelectedAdminSpiel(spiel)}
      />

      {selectedAdminSpiel && (
        <AdminEditSpielDataModal
          spielData={selectedAdminSpiel}
          teams={teams}
          spielorte={spielorte}
          schiedsrichter={schiedsrichter}
          isOpen={true}
          onClose={() => setSelectedAdminSpiel(null)}
        />
      )}
    </div>
  );
}

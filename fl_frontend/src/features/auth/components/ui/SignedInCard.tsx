"use client";

import Link from "next/link";

import { Button } from "@heroui/react/button";

import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { useSignOut } from "@/shared/hooks/useSignOut";

import { signOutAction } from "../../actions";

/**
 * `/signin` for somebody already signed in, instead of a second sign-in: its passkey offer would list
 * the signed-in account's passkeys alone, and a code would replace the session this reader holds.
 */
export function SignedInCard({ address }: { address: string }) {
  const { confirm, press, disarm } = useSignOut(signOutAction);

  return (
    <SignInCard
      title="Anmelden"
      ornament={<span className="mb-3 text-4xl sm:text-5xl">⚽</span>}>
      <div className="flex flex-col gap-y-4">
        <p className="text-center fluid-sm text-foreground">
          Du bist als <span className="font-bold break-all">{address}</span> angemeldet.
        </p>

        {/* A plain link: the landing decides where a signed-in visitor goes, as after every sign-in. */}
        <Link
          href={SIGN_IN_LANDING}
          // `ctaButton`'s `css` hover: `formButton` hovers on `data-hovered`, which no link is given.
          className={`${ctaButton({ intent: "primary", hover: "css" })} w-full`}>
          Weiter zu Deinem Bereich
        </Link>

        <Button
          type="button"
          variant="secondary"
          isPending={confirm.isPending}
          data-signout-control="true"
          onPress={press}
          onBlur={disarm}
          // The link's recipe, so the pair keeps one weight.
          className={`${ctaButton({ intent: "outline", hover: "aria" })} w-full`}>
          {confirm.isConfirming ? (confirm.isPending ? "Meldet ab..." : "Abmelden?") : "Abmelden"}
        </Button>
      </div>
    </SignInCard>
  );
}

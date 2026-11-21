import { redirect } from "next/navigation";

import { getPasskeyStep } from "@/core/auth/landing";
import { RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { ROUTES } from "@/core/routes";
import { PasskeyStep } from "@/features/auth/PasskeyStep";
import { pageMetadata } from "@/shared/utils/metadata";

type Props = PageProps<"/signin/passkey">;

/** No description, as `/signin` carries none. */
export const metadata = pageMetadata(ROUTES.signInPasskey);

// Never under `/admin`: the session that must reach this page is the one the admin guard is
// refusing, so a page behind that guard is a page nobody can open.

/** The passkey step the session on the request owes. */
export default async function PasskeyPage({ searchParams }: Props) {
  return await readView(searchParams);
}

async function readView(searchParams: Props["searchParams"]) {
  // Which control stands here is the guard's answer and never this page's: the requirement it
  // enforces is judged per request, beside the session lifetimes.
  const step = await getPasskeyStep();
  if (step === null) {
    // The proxy sends a session holding no step on before the render; one whose step ended since, a window closing or
    // a passkey enrolled in another tab, goes on from here, with the address a mailed link asked for where the
    // allowlist holds it.
    const asked = (await searchParams)[RETURN_PARAMETER];
    redirect(withReturnAddress(ROUTES.signInLanding.path(), typeof asked === "string" ? asked : null));
  }

  return (
    <PasskeyStep
      step={step.step}
      address={step.email}
      next={ROUTES.signInLanding.path()}
    />
  );
}

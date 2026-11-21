import { connection } from "next/server";

import { allowedReturnAddress, RETURN_PARAMETER } from "@/core/auth/returnAddress";
import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { SignInFlow } from "@/features/auth/SignInFlow";
import { pageMetadata } from "@/shared/utils/metadata";

type Props = PageProps<"/signin">;

/** No description: a sign-in page carries none. */
export const metadata = pageMetadata(ROUTES.signIn);

/**
 * The sign-in form, for a visitor holding no session: the proxy sends one holding a session on to the landing before
 * this page renders.
 */
export default async function SignInPage({ searchParams }: Props) {
  return await readView(searchParams);
}

async function readView(searchParams: Props["searchParams"]) {
  // The key off the request's settings: a prerendered shell would carry the build's, which is none.
  await connection();
  const asked = (await searchParams)[RETURN_PARAMETER];
  return (
    <SignInFlow
      next={ROUTES.signInLanding.path()}
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
      offersPasskey={asksForAdministration(allowedReturnAddress(typeof asked === "string" ? asked : null))}
    />
  );
}

/**
 * Whether the sign-in was opened from the administration, the proxy carrying its page in the address: only an
 * administrator holds a passkey, so everyone else is offered the code alone.
 */
function asksForAdministration(returnsTo: string | null): boolean {
  const administration = ROUTES.admin.path();
  return returnsTo !== null && (returnsTo === administration || returnsTo.startsWith(`${administration}/`));
}

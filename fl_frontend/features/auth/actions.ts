"use server";

import { signIn } from "@/core/auth";
import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";

type FormState =
  | {
      message?: string;
      success?: boolean;
    }
  | undefined;

export async function handleSignIn(prevState: FormState, formData: FormData): Promise<FormState> {
  const email = formData.get("email") as string;

  try {
    // Attempt sign in with Auth.js
    await signIn("resend", { email, redirectTo: "/admin" });

    return { success: true };
  } catch (error) {
    // 1. Rethrow Next.js redirects IMMEDIATELY
    if (isRedirectError(error)) {
      throw error;
    }

    // 2. Handle Auth.js errors
    if (error instanceof AuthError) {
      return {
        message: "Access Denied. Your email is not authorized to access the Admin Portal.",
      };
    }

    // 3. Fallback for unexpected errors
    throw error;
  }
}

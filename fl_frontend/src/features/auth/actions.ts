"use server";

import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";

import { signIn } from "@/core/auth";

import type { FormState } from "@/shared/types/types";

export async function handleSignIn(prevState: FormState | undefined, formData: FormData): Promise<FormState> {
  const email = formData.get("email") as string;

  try {
    // Attempt sign in with Auth.js
    await signIn("resend", { email, redirectTo: "/admin" });

    return { success: true };
  } catch (error) {
    // 1. Rethrow Next.js redirects IMMEDIATELY
    unstable_rethrow(error);

    // 2. Handle Auth.js errors
    if (error instanceof AuthError) {
      return {
        success: false,
        error: "Zugriff verweigert. Diese E-Mail-Adresse ist nicht für das Admin-Portal freigegeben.",
      };
    }

    // 3. Fallback for unexpected errors
    throw error;
  }
}

import { redirect } from "next/navigation";

import { getSubjectSession } from "@/core/subject";

import type { SubjectSession } from "@/core/subject";

/**
 * The signed-in person, or a redirect to sign in: every person and team page reads its subject here
 * (`docs/frontend/spec.md :: I377`). A layout's guard does not rerun on a soft navigation, so a page
 * reading `getSubjectSession` itself renders empty for a lapsed session rather than sending it on.
 */
export async function requireSubjectSession(): Promise<SubjectSession> {
  const subject = await getSubjectSession();
  if (subject === null) redirect("/signin");

  return subject;
}

/**
 * E2E · the sign-in code, read where the stack files the mail it does not send.
 *
 * `APP_ENV=local` writes every message to the frontend's sink instead of sending it
 * (`fl_frontend/src/core/mail.ts :: writeToSink`), and docker-compose.e2e.yml mounts that sink at
 * `.tmp-e2e/mail` in the checkout, so a journey reads its code as a person reads theirs: from the
 * message. No route, flag or store exists for the journeys alone.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "@playwright/test";

/** In the checkout's root, three levels above `fl_frontend/e2e/support/`. */
const MAIL_SINK = path.resolve(__dirname, "..", "..", "..", ".tmp-e2e", "mail");

/** `fl_frontend/src/core/authEmail.ts :: buildCodeEmail`'s subject, up to the brand. */
const CODE_SUBJECT = "Subject: Dein Anmeldecode";

/** The messages filed so far, taken before a send so the code read after it is that send's. */
export async function filedMessages(): Promise<ReadonlySet<string>> {
  try {
    return new Set(await readdir(MAIL_SINK));
  } catch (error) {
    // A sink nothing has written to yet holds no message.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Set();
    throw error;
  }
}

/** The code a message filed after `before` carries to `address`, waited for as the send is. */
export async function mailedCode(address: string, before: ReadonlySet<string>): Promise<string> {
  let code: string | null = null;

  await expect
    .poll(
      async () => {
        code = await codeAmong(address, before);
        return code;
      },
      { message: `a sign-in code mailed to ${address} in ${MAIL_SINK}`, timeout: 20_000 },
    )
    .not.toBeNull();

  if (code === null) throw new Error(`no sign-in code reached ${address}`);
  return code;
}

async function codeAmong(address: string, before: ReadonlySet<string>): Promise<string | null> {
  // Newest first: a name opens with the moment it was filed (`fl_frontend/src/core/mail.ts :: sinkFileStem`).
  const filed = (await readdir(MAIL_SINK))
    .filter((name) => name.endsWith(".html") && !before.has(name))
    .sort()
    .reverse();

  for (const name of filed) {
    const document = await readFile(path.join(MAIL_SINK, name), "utf8");
    // The comment heading the file carries the envelope and the plain-text part, where the code
    // stands on a line of its own (`fl_frontend/src/core/mail.ts :: sinkDocument`).
    const header = document.slice(document.indexOf("<!--") + "<!--".length, document.indexOf("-->"));
    const lines = header.split("\n");

    if (!lines.includes(`To: ${address}`) || !lines.some((line) => line.startsWith(CODE_SUBJECT))) continue;

    const code = lines.find((line) => /^\d{6}$/.test(line));
    if (code !== undefined) return code;
  }

  return null;
}

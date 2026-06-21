import { connection } from "next/server";
import { getGermanDateStr } from "@/shared/utils/utils";
import ServerConfigProvider from "@/core/providers/ServerConfigProvider";

export default async function DynamicLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const today = getGermanDateStr();

  return <ServerConfigProvider serverConfig={{ today }}>{children}</ServerConfigProvider>;
}

import { connection } from "next/server";
import { getLeagueTodayString } from "@/shared/utils";
import ServerConfigProvider from "@/core/providers/ServerConfigProvider";

export default async function DynamicLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const today = getLeagueTodayString();

  return <ServerConfigProvider serverConfig={{ today }}>{children}</ServerConfigProvider>;
}

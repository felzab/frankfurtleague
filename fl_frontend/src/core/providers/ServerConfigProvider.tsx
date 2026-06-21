"use client";

import { createContext, useContext } from "react";

export interface ServerConfig {
  today: string;
}

const ServerConfigContext = createContext<ServerConfig | null>(null);

export default function ServerConfigProvider({ children, serverConfig }: { children: React.ReactNode; serverConfig: ServerConfig }) {
  return <ServerConfigContext.Provider value={serverConfig}>{children}</ServerConfigContext.Provider>;
}

export const useServerConfig = () => {
  const context = useContext(ServerConfigContext);
  if (!context) {
    throw new Error("useServerConfig must be used within a ServerConfigProvider");
  }
  return context;
};

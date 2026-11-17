import { createServer, connect as dial } from "node:net";

import { assert } from "vitest";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { Socket } from "node:net";

/**
 * A TCP relay to the mongod that can stop passing the client's requests on: a hung connection as the
 * client meets it, every socket open and nothing answering.
 */
export class StoreRelay {
  private hung = false;
  private refusing = false;
  /** The command whose first request hangs the relay, as its name opens a BSON key. */
  private trigger: Buffer | null = null;
  /** Whether `hangFrom`'s command was ever sent, without which its case proves nothing. */
  triggered = false;
  private readonly sockets = new Set<Socket>();
  /**
   * Connections holding a request the relay will never answer, ended with their scenario: the
   * monitor's awaitable hello waits 13 s on one, and its timeout interrupts whatever then runs, a
   * later case's commit included.
   */
  private readonly stranded = new Set<Socket>();
  private readonly server = createServer((inbound) => {
    if (this.refusing) {
      inbound.destroy();
      return;
    }
    const outbound = dial(this.mongod.getMappedPort(27017), this.mongod.getHost());
    for (const socket of [inbound, outbound]) {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => undefined);
    }
    inbound.on("data", (chunk: Buffer) => {
      if (this.trigger !== null && chunk.includes(this.trigger)) {
        this.hung = true;
        this.triggered = true;
      }
      // Requests are dropped and never answers, so no connection is left holding a reply to a request
      // its client has already given up on.
      if (!this.hung) outbound.write(chunk);
      else this.stranded.add(inbound);
    });
    outbound.on("data", (chunk) => inbound.write(chunk));
    inbound.on("close", () => outbound.destroy());
    outbound.on("close", () => inbound.destroy());
  });

  constructor(private readonly mongod: StartedMongoDBContainer) {}

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    assert.ok(address !== null && typeof address === "object");
    return address.port;
  }

  /** Runs `body` while nothing the client sends reaches the server, and passes it on again after. */
  async hang<T>(body: () => Promise<T>): Promise<T> {
    this.hung = true;
    try {
      return await body();
    } finally {
      this.resume();
    }
  }

  /** `hang` from the first request carrying `command` on, every request before it answered. */
  async hangFrom<T>(command: string, body: () => Promise<T>): Promise<T> {
    this.triggered = false;
    this.trigger = Buffer.from(`${command}\0`);
    try {
      return await body();
    } finally {
      this.resume();
    }
  }

  /** Runs `body` while every connection the client opens is closed at once, as a server refusing it. */
  async refuse<T>(body: () => Promise<T>): Promise<T> {
    this.refusing = true;
    try {
      return await body();
    } finally {
      this.refusing = false;
    }
  }

  /**
   * Runs `body` while the store is gone: every socket open through the relay closed and every new one
   * refused. A hang is no outage to the client's monitor, whose streamed heartbeats keep arriving.
   */
  async sever<T>(body: () => Promise<T>): Promise<T> {
    this.refusing = true;
    for (const socket of this.sockets) socket.destroy();
    try {
      return await body();
    } finally {
      this.refusing = false;
    }
  }

  private resume(): void {
    this.hung = false;
    this.trigger = null;
    this.endStranded();
  }

  /** Closes every connection a scenario left waiting on an answer, its outbound half with it. */
  private endStranded(): void {
    for (const socket of this.stranded) socket.destroy();
    this.stranded.clear();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

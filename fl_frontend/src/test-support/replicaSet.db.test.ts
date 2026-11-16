// The replica set's own guarantee after each case, which every db file relies on and none tests: a transaction a case
// leaves open fails that case, and is ended, so no later case waits behind it.
import { caseFailures } from "@/test-support/caseFailures";
import { replicaSetUrl, startReplicaSet } from "@/test-support/replicaSet";
import { MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";

const { mongod, closing } = await startReplicaSet();

const client = new MongoClient(replicaSetUrl(mongod));
closing(() => client.close());

const { failsNaming } = caseFailures();

/** Every transaction the server holds open, a running request's or an idle session's. */
const openTransactions = () =>
  client
    .db("admin")
    .aggregate([{ $currentOp: { allUsers: true, idleSessions: true } }, { $match: { transaction: { $exists: true } } }])
    .toArray();

describe("the replica set's check after each case", () => {
  failsNaming("fails the case that leaves a transaction open", /^1 transaction\(s\) stood open once the case ended/, async () => {
    const session = client.startSession();
    session.startTransaction();
    // The server opens the transaction at its first operation, which neither a commit nor an abort follows.
    await client.db("held").collection("rows").insertOne({ left: "open" }, { session });
  });

  it("leaves no transaction open once it has failed that case", async () => {
    expect(await openTransactions()).toStrictEqual([]);
  });
});

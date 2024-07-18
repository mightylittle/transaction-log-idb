/*
 * Copyright (c) 2024 John Newton
 * SPDX-License-Identifier: Apache-2.0
 */
import { assert } from "https://unpkg.com/chai/chai.js";
import { IDBBatchedTransactionLog } from "../dist/transaction-log-idb.module.js";

describe("IDBBatchedTransactionLog", function() {
  this.timeout(5000);
  let log;

  beforeEach(() => {
    log = new IDBBatchedTransactionLog("test-idb-batched-transaction-log");
  });

  afterEach(async () => {
    const open = await log.isOpen();
    if (open) {
      await log.close();
      await log.clear();
    } else {
      try {
        log.clear();
      } catch(error) {
        console.warn(error);
      }
    }
  });

  it("opens and closes the transaction-log", async () => {
    assert.isUndefined(await log.open());
    assert.isUndefined(await log.close());
  });

  it("'open()' throws an error if the transaction-log is already open", async () => {
    assert.isUndefined(await log.open());

    let thrownError;

    try {
      await log.open();
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
    assert.isUndefined(await log.close());
  });

  it("'close()' throws an error if the transaction-log is already closed", async () => {
    assert.isUndefined(await log.open());
    assert.isUndefined(await log.close());

    let thrownError;

    try {
      await log.close();
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'append()' returns undefined, appending a transaction to the buffer", async () => {
    await log.open();
    assert.isUndefined(log.append({type: "move", x: 2, y: 1}));
    assert.equal(0, await log.countTransactions());
    assert.equal(0, await log.countCommits());
  });

  it("'append()' throws an error when the transaction-log is closed", async () => {
    await log.open();
    await log.close();

    let thrownError;

    try {
      await log.append({type: "move", x: 2, y: 1});
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'commit()' commits transactions from the buffer to the transaction-log", async () => {
    await log.open();

    assert.isUndefined(log.append({type: "move", x: 2, y: 1}));
    assert.isUndefined(log.append({type: "move", x: 0, y: 1}));
    assert.isUndefined(log.append({type: "move", x: 1, y: 1}));

    assert.equal(0, await log.countTransactions());
    assert.equal(0, await log.countCommits());

    assert.isUndefined(await log.commit());

    assert.equal(3, await log.countTransactions());
    assert.equal(1, await log.countCommits());

    assert.isUndefined(log.append({type: "move", x: 2, y: 2}));
    assert.isUndefined(await log.commit());

    assert.equal(4, await log.countTransactions());
    assert.equal(2, await log.countCommits());
  });

  it("'countTransactions()' throws an error when the log is closed", async () => {
    let thrownError;

    try {
      await log.countTransactions();
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'clear()' throws an error if the transaction-log is open", async () => {
    assert.isUndefined(await log.open());

    let thrownError;

    try {
      await log.clear();
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'clear()' resets the log", async () => {
    assert.isUndefined(await log.open());
    assert.isUndefined(log.append({type: "move", x: 2, y: 1}));
    assert.isUndefined(log.append({type: "move", x: 1, y: 1}));
    assert.isUndefined(log.append({type: "move", x: 0, y: 1}));
    assert.isUndefined(await log.commit());
    assert.equal(3, await log.countTransactions());
    assert.equal(1, await log.countCommits());
    assert.isUndefined(await log.close());
    assert.isUndefined(await log.clear());
    await log.open();
    assert.equal(0, await log.countTransactions());
    assert.equal(0, await log.countCommits());
  });

  it("'replay()' iterates over the transaction-log entries, calling the provided function", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    const entries = [];

    await log.replay((entry) => {
      entries.push(entry);
    });

    assert.lengthOf(entries, 4);

    const [first, second, third, fourth] = entries;

    assert.deepStrictEqual(first, moveZero);
    assert.deepStrictEqual(second, moveOne);
    assert.deepStrictEqual(third, moveTwo);
    assert.deepStrictEqual(fourth, moveThree);
  });

  it("'replay()' throws an error when the transaction-log is closed", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    const entries = [];

    await log.close();

    let thrownError;

    try {
      await log.replay((entry) => {
        entries.push(entry);
      });
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'getSeqRangeTransactions()' resolves to the entries within the given range", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    const entries = await log.getSeqRangeTransactions(3, 4);
    assert.lengthOf(entries, 2);
    const [first, second] = entries;
    assert.deepStrictEqual(first.data, moveTwo);
    assert.deepStrictEqual(second.data, moveThree);

    await log.close();
  });

  it("'getSeqRangeTransactions()' without a finishId resolves to all entries started with the startId", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    await log.commit();
    log.append(moveTwo);
    await log.commit();
    log.append(moveThree);
    await log.commit();

    const entries = await log.getSeqRangeTransactions(2);

    assert.lengthOf(entries, 3);
    const [first, second, third] = entries;
    assert.deepStrictEqual(first.data, moveOne);
    assert.deepStrictEqual(second.data, moveTwo);
    assert.deepStrictEqual(third.data, moveThree);

    await log.close();
  });

  it("'getSeqRangeTransactions()' throws an error when the transaction-log is closed", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    await log.close();

    let thrownError;

    try {
      const _entries = await log.getSeqRangeTransactions(2, 3);
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });

  it("'getSeqRangeCommits()' resolves to the commits within the given range", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};
    const moveFour = {type: "move", player: 1, x: 2, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    log.append(moveFour);

    await log.commit();

    const commits = await log.getSeqRangeCommits(2, 3);
    assert.lengthOf(commits, 2);

    const [first, second] = commits;
    assert.equal(first.id, 2);
    assert.equal(second.id, 3);
    assert.equal(first.transactions.length, 1);
    assert.equal(second.transactions.length, 1);
    assert.deepStrictEqual(first.transactions[0].data, moveThree);
    assert.deepStrictEqual(second.transactions[0].data, moveFour);

    await log.close();
  });

  it("'getSeqRangeCommits()' without a finishId resolves to all entries started with the startId", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};
    const moveFour = {type: "move", player: 1, x: 2, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    log.append(moveFour);

    await log.commit();

    const commits = await log.getSeqRangeCommits(2);
    assert.lengthOf(commits, 2);

    const [first, second] = commits;
    assert.equal(first.id, 2);
    assert.equal(second.id, 3);
    assert.equal(first.transactions.length, 1);
    assert.equal(second.transactions.length, 1);
    assert.deepStrictEqual(first.transactions[0].data, moveThree);
    assert.deepStrictEqual(second.transactions[0].data, moveFour);

    await log.close();
  });

  it("'getSeqRangeCommits()' throws an error when the transaction-log is closed", async () => {
    await log.open();

    const moveZero = {type: "move", player: 1, x: 2, y: 1};
    const moveOne = {type: "move", player: 2, x: 1, y: 2};
    const moveTwo = {type: "move", player: 1, x: 0, y: 1};
    const moveThree = {type: "move", player: 2, x: 0, y: 2};

    log.append(moveZero);
    log.append(moveOne);
    log.append(moveTwo);

    await log.commit();

    log.append(moveThree);

    await log.commit();

    await log.close();

    let thrownError;

    try {
      const _entries = await log.getSeqRangeCommits(1, 2);
    } catch(error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
  });
});

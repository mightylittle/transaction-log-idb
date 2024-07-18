/*
 * Copyright (c) 2024 John Newton
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  DBSchema,
  IDBPDatabase,
  IDBPTransaction
} from "idb";
import {
  openDB,
  deleteDB
} from "idb";
import type {
  Commit,
  CommitInfo,
  Transaction,
  BatchedTransactionLogCallbacks
} from "@mightylittle/transaction-log";
import {
  BatchedTransactionLog,
  LOG_CLOSED_MESSAGE,
  LOG_ALREADY_OPEN_MESSAGE,
  LOG_ALREADY_CLOSED_MESSAGE,
  LOG_OPEN_CANNOT_CLEAR_MESSAGE,
  INVALID_SEQUENCE_ID_MESSAGE,
  UNEXPECTED_CURSOR_VALUE_ERROR_MESSAGE,
  FAILED_TO_COMMIT_TRANSACTIONS_MESSAGE
} from "@mightylittle/transaction-log";

/**
 * @remarks
 * IDB database schema for storing batched transaction logs.
 */
export interface BatchedTransactionLogDBSchema<T> extends DBSchema {
  commit: {
    key: number;
    value: Commit;
    indexes: {
      "time": number;
    };
  },
  txn: {
    key: number;
    value: Transaction<T>;
    indexes: {
      "time": number;
    }
  }
};

/**
 * @remarks
 * IndexedDB implementation of a batched transaction-log: entries are committed as a
 * batch operation.
 */
export default class IDBBatchedTransactionLog<T> implements BatchedTransactionLog<T> {
  private readonly dbName: string;
  private readonly callbacks: BatchedTransactionLogCallbacks<T>;
  private buffer: Transaction<T>[] = [];
  private db: IDBPDatabase<BatchedTransactionLogDBSchema<T>> | null = null;

  constructor(dbName: string, callbacks?: BatchedTransactionLogCallbacks<T>) {
    if (!dbName) {
      throw new Error("db-name must be set");
    }
    this.dbName = dbName;
    this.callbacks = callbacks || {};
  };

  public async isOpen(): Promise<boolean> {
    return !!this.db;
  };

  public async open(): Promise<void> {
    if (this.db) {
      throw new Error(LOG_ALREADY_OPEN_MESSAGE);
    }

    this.db = await openDB<BatchedTransactionLogDBSchema<T>>(this.dbName, 1, {
      upgrade(db, _oldVersion, _newVersion, _transaction, _event) {
        if (!db.objectStoreNames.contains("commit")) {
          const store = db.createObjectStore("commit", {
            keyPath: "id",
            autoIncrement: true
          });
          store.createIndex("time", "time");
        }
        if (!db.objectStoreNames.contains("txn")) {
          const store = db.createObjectStore("txn", {
            keyPath: "id",
            autoIncrement: true
          });
          store.createIndex("time", "time");
        }
      }
    });

    this.callbacks.onopen?.apply(this);
  };

  public async close(): Promise<void> {
    if (!this.db) {
      throw new Error(LOG_ALREADY_CLOSED_MESSAGE);
    }

    await this.db.close();

    this.db = null;
    this.callbacks.onclose?.apply(this);
  };

  public async clear(): Promise<void> {
    if (this.db) {
      throw new Error(LOG_OPEN_CANNOT_CLEAR_MESSAGE);
    }

    const dbName = this.dbName;

    await deleteDB(dbName, {
      blocked() {
        console.error("blocked from deleting DB", dbName);
      }
    });

    this.callbacks.onclear?.apply(this);
  };

  public async countCommits(): Promise<number> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    return await this.db!.count("commit");
  };

  public async countTransactions(): Promise<number> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    return await this.db!.count("txn");
  };

  public append(data: T): void {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    const txn: Transaction<T> = {time: performance.now(), data};

    this.buffer.push(txn);

    this.callbacks.onappend?.apply(this, [data]);
  };

  public async commit(): Promise<void> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    let tx: IDBPTransaction<BatchedTransactionLogDBSchema<T>, ("commit" | "txn")[], "readwrite"> | undefined;
    let commitId;

    try {
      tx = this.db!.transaction(["commit", "txn"], "readwrite");
      const commitStore = tx.objectStore("commit");
      const txnStore = tx.objectStore("txn");

      const transactionIds = await Promise.all(
        this.buffer.map((transaction: Transaction<T>) => txnStore.add(transaction))
      );

      const commit: Commit = {
        time: performance.now(),
        transactions: transactionIds
      };

      commitId = await commitStore.add(commit);

      await tx.done;
    } catch (error) {
      console.error(error);
      tx?.abort();
    }

    if (!commitId) throw new Error(FAILED_TO_COMMIT_TRANSACTIONS_MESSAGE);

    this.buffer = [];
  };

  public async replay(callback: (data: T) => void): Promise<void> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    const tx = await this.db!.transaction("txn", "readonly");
    let cursor = await tx.store.openCursor();

    while (cursor) {
      const txn = cursor.value;
      callback(txn.data);
      cursor = await cursor.continue();
    }

    await tx.done;
  };

  public async getSeqRangeCommits(startId: number, finishId?: number): Promise<CommitInfo<T>[]> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    if (startId < 1) {
      throw new Error(INVALID_SEQUENCE_ID_MESSAGE);
    }

    let range;

    if (finishId) {
      range = IDBKeyRange.bound(startId, finishId, false, false);
    } else {
      range = IDBKeyRange.lowerBound(startId, false);
    }

    const tx = await this.db!.transaction("commit", "readonly");

    let cursor = await tx.store.openCursor(range);

    const commits: [number, Commit][] = [];

    while (cursor) {
      commits.push([cursor.key, cursor.value]);
      cursor = await cursor.continue();
    }

    const commitInfo: CommitInfo<T>[] = [];

    for (const [commitId, commit] of commits) {
      const transactions: Transaction<T>[] = [];

      for (const transactionId of commit.transactions) {
        const transaction: Transaction<T> | undefined = await this.db!.get("txn", transactionId);
        if (!transaction) {
          throw new Error("Transaction not found.");
        }
        transactions.push(transaction);
      }

      commitInfo.push({
        id: commitId,
        time: commit.time,
        transactions
      });
    }

    await tx.done;

    return commitInfo;
  };

  public async getSeqRangeTransactions(startId: number, finishId?: number): Promise<Transaction<T>[]> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    let range;

    if (finishId) {
      range = IDBKeyRange.bound(startId, finishId, false, false);
    } else {
      range = IDBKeyRange.lowerBound(startId, false);
    }

    const tx = await this.db!.transaction("txn", "readonly");

    let cursor = await tx.store.openCursor(range);

    const transactions: Transaction<T>[] = [];

    while (cursor) {
      transactions.push(cursor.value);
      cursor = await cursor.continue();
    }

    await tx.done;

    return transactions;
  };
};

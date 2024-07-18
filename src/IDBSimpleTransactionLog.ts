/*
 * Copyright (c) 2024 John Newton
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  DBSchema,
  IDBPDatabase
} from "idb";
import {
  openDB,
  deleteDB
} from "idb";
import type {
  Transaction,
  SimpleTransactionLogCallbacks
} from "@mightylittle/transaction-log";
import {
  SimpleTransactionLog,
  LOG_CLOSED_MESSAGE,
  LOG_ALREADY_OPEN_MESSAGE,
  LOG_ALREADY_CLOSED_MESSAGE,
  LOG_OPEN_CANNOT_CLEAR_MESSAGE,
  UNEXPECTED_CURSOR_VALUE_ERROR_MESSAGE
} from "@mightylittle/transaction-log";

/**
 * @remarks
 * IDB database schema for storing simple transaction logs.
 */
export interface SimpleTransactionLogDBSchema<T> extends DBSchema {
  simpletxn: {
    key: number;
    value: Transaction<T>;
    indexes: {
      "time": number;
    };
  };
};

/**
 * @remarks
 * IndexedDB implementation of a "simple" transaction-log: each entry is committed
 * at the time of append, i.e. not as a batch operation.
 */
export default class IDBSimpleTransactionLog<T> implements SimpleTransactionLog<T> {
  private readonly dbName: string;
  private readonly callbacks: SimpleTransactionLogCallbacks<T>;
  private db: IDBPDatabase<SimpleTransactionLogDBSchema<T>> | null = null;

  constructor(dbName: string, callbacks?: SimpleTransactionLogCallbacks<T>) {
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

    this.db = await openDB<SimpleTransactionLogDBSchema<T>>(this.dbName, 1, {
      upgrade(db, _oldVersion, _newVersion, _transaction, _event) {
        if (!db.objectStoreNames.contains("simpletxn")) {
          const store = db.createObjectStore("simpletxn", {
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

  public async countTransactions(): Promise<number> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    return await this.db!.count("simpletxn");
  };

  public async append(data: T): Promise<void> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    const txn: Transaction<T> = {time: performance.now(), data};
    const tx = this.db.transaction("simpletxn", "readwrite");

    await Promise.all([tx.store.add(txn), tx.done]);

    this.callbacks.onappend?.apply(this, [data]);
  };

  public async replay(callback: (data: T) => void): Promise<void> {
    if (!this.db) {
      throw new Error(LOG_CLOSED_MESSAGE);
    }

    const tx = await this.db!.transaction("simpletxn", "readonly");
    let cursor = await tx.store.openCursor();

    while (cursor) {
      const txn = cursor.value;
      callback(txn.data);
      cursor = await cursor.continue();
    }
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

    const tx = await this.db!.transaction("simpletxn", "readonly");

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

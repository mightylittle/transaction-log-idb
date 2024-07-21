# @mightylittle/transaction-log-idb

> Replayable logs using IndexedDB

The package defines two exported classes:

* IDBSimpleTransactionLog
* IDBBatchedTransactionLog

## Usage

### IDBSimpleTransactionLog

JavaScript example:

```javascript
import { IDBSimpleTransactionLog } from "@mightylittle/transaction-log-idb";

async function start () {
  const log = new IDBSimpleTransactionLog();
  await log.open();
  await log.append("foo");
  await log.append("bar");
  await log.countTransactions(); // => 2
  await log.replay((data) => console.log("data", data));
  console.log("transactions", await log.getSeqRangeTransactions(1, 2)); // returns the first and second entries
  await log.close();
  await log.clear();
}
```

### IDBBatchedTransactionLog

JavaScript example:

```javascript
import { IDBBatchedTransactionLog } from "@mightylittle/transaction-log-idb";

async function start () {
  const log = new IDBBatchedTransactionLog();
  await log.open();
  log.append("foo");
  log.append("bar");
  await log.commit();
  await log.countTransactions(); // => 2
  await log.countCommits(); // => 1
  await log.replay((data) => console.log("data", data), true);
  console.log("transactions", await log.getSeqRangeTransactions(1, 2)); // prints the first and second entries
  console.log("commits", await log.getSeqRangeCommits(1)); // prints the first and any later commits
  await log.close();
  await log.clear();
}
```

## Installation

```sh
npm install
```

## Development

Build:

```sh
npm run build
```

Run tests:

```sh
npm run test
```

NOTE: the mocha tests run in-browser, where IndexedDB is supported.

Generate documentation:

```sh
npm run typedoc
```

## Dependencies

* [idb](https://www.npmjs.com/package/idb)

## Author

* John Newton

## Copyright

* John Newton

## License

Apache-2.0

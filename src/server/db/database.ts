// データベース（SQLite・1ファイル）を開く
//
// Node.jsに最初から入っている node:sqlite を使う。
// 追加のインストールやビルドが要らないので、Windowsでも npm install で失敗しにくい。

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** SQLiteに渡せる値 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL：書き込み中でも読み出せる。落ちても壊れにくい
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/** まとめて書き込む。途中で失敗したら全部取り消す */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** undefined と true/false を、SQLiteに渡せる値に直す */
export function sql(value: string | number | boolean | null | undefined): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

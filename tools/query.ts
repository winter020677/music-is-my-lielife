// 配信の記録（データベース）を、読み取り専用で調べる道具（要件 V-9）
//
// 使い方（プロジェクトのフォルダで）：
//   npm run query -- "SELECT * FROM streams ORDER BY started_at DESC LIMIT 5"
//   npm run query -- --csv "SELECT ..."   … CSVで出す（Excel・スプレッドシート用）
//   npm run query -- --json "SELECT ..."  … JSONで出す
//
// 読み取り専用で開くので、記録を書き換えたり壊したりすることはない。
// 表の説明は docs/database.md を見る。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PROJECT_ROOT, resolveDataDir, resolvePaths } from '../src/server/config/paths.ts';
import { SecretStore } from '../src/server/config/secrets.ts';

const args = process.argv.slice(2);
const format = args.includes('--csv') ? 'csv' : args.includes('--json') ? 'json' : 'table';
const sqlText = args.filter((a) => !a.startsWith('--')).join(' ').trim();

if (!sqlText) {
  console.log('使い方：npm run query -- "SELECT * FROM streams ORDER BY started_at DESC LIMIT 5"');
  process.exit(1);
}

const env = new SecretStore(join(PROJECT_ROOT, '.env'));
env.load();
const dataDir = resolveDataDir({ ...process.env, DATA_DIR: env.get('DATA_DIR') || process.env.DATA_DIR });
const { dbFile } = resolvePaths(dataDir);
if (!existsSync(dbFile)) {
  console.error(`データベースが見つかりません：${dbFile}`);
  process.exit(1);
}

const db = new DatabaseSync(dbFile, { readOnly: true });
const rows = db.prepare(sqlText).all() as Array<Record<string, unknown>>;
db.close();

if (format === 'json') {
  console.log(JSON.stringify(rows, null, 2));
} else if (format === 'csv') {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const cell = (v: unknown) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  console.log(columns.join(','));
  for (const row of rows) console.log(columns.map((c) => cell(row[c])).join(','));
} else {
  console.table(rows.map((r) => ({ ...r })));
  console.log(`${rows.length}行（データベース：${dbFile}）`);
}

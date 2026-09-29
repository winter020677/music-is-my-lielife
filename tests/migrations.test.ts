// データベースの移行（要件 N-10）のテスト
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/database.ts';
import { LATEST_VERSION, currentVersion, migrate, pendingMigrations } from '../src/server/db/migrations.ts';

describe('移行', () => {
  it('空のデータベースに、全部の表を作る', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual({ from: 0, to: LATEST_VERSION });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(
      (t) => t.name,
    );
    for (const name of [
      'streams',
      'viewers',
      'viewer_names',
      'visits',
      'gifts',
      'comments',
      'likes',
      'social',
      'viewer_counts',
      'rule_runs',
      'gift_catalog',
      'daily_counters',
      'seen_messages',
      'schema_migrations',
    ]) {
      expect(tables).toContain(name);
    }
  });

  it('2回目は何もしない', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
    expect(pendingMigrations(db)).toEqual([]);
  });

  it('アプリより新しいデータベースは、壊さないように止める', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(LATEST_VERSION + 1, '未来', 'x');
    expect(currentVersion(db)).toBe(LATEST_VERSION + 1);
    expect(() => pendingMigrations(db)).toThrow(/新しい/);
  });
});

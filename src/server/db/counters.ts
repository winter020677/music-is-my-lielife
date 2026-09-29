// 日ごとの回数（Euler Streamのリクエスト数、配信待ちの確認の回数など）
// 日付はUTCで区切る（Euler Streamの1日の枠もUTCで区切られるため）

import type { StatementSync } from 'node:sqlite';
import { utcDayOf } from '../core/time.ts';
import type { Db } from './database.ts';

export class DailyCounters {
  private readonly now: () => number;
  private readonly incrementStmt: StatementSync;
  private readonly selectDayStmt: StatementSync;

  constructor(db: Db, now: () => number = Date.now) {
    this.now = now;
    this.incrementStmt = db.prepare(
      `INSERT INTO daily_counters (day, key, count) VALUES (?, ?, ?)
       ON CONFLICT (day, key) DO UPDATE SET count = daily_counters.count + excluded.count`,
    );
    this.selectDayStmt = db.prepare('SELECT key, count FROM daily_counters WHERE day = ?');
  }

  today(): string {
    return utcDayOf(this.now());
  }

  increment(key: string, by = 1): void {
    this.incrementStmt.run(this.today(), key, by);
  }

  /** ある日の回数（key → 回数） */
  forDay(day: string = this.today()): Record<string, number> {
    const rows = this.selectDayStmt.all(day) as Array<{ key: string; count: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.key] = row.count;
    return out;
  }

  /** ある日の、名前が prefix で始まる回数の合計 */
  sum(prefix: string, day: string = this.today()): number {
    let total = 0;
    for (const [key, count] of Object.entries(this.forDay(day))) {
      if (key.startsWith(prefix)) total += count;
    }
    return total;
  }
}

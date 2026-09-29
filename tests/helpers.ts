// テストで使う道具
import { silentLogger } from '../src/server/core/logger.ts';
import type { GiftEvent, LiveEvent, Viewer } from '../src/server/core/events.ts';
import { openDatabase, type Db } from '../src/server/db/database.ts';
import { migrate } from '../src/server/db/migrations.ts';

export const log = silentLogger().area('テスト');

export function memoryDb(): Db {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

export function viewer(id: string, nickname = `視聴者${id}`, extra: Partial<Viewer> = {}): Viewer {
  return { id, uniqueId: `user${id}`, nickname, avatarUrl: null, followStatus: null, ...extra };
}

let serial = 0;

/** イベントを作る（足りない項目はそれらしい値で埋める） */
export function event(kind: LiveEvent['kind'], fields: Record<string, unknown> = {}): LiveEvent {
  serial += 1;
  const base = { at: new Date().toISOString(), msgId: `m${serial}`, isTest: false, late: false };
  if (kind === 'gift') {
    const gift: GiftEvent = {
      ...base,
      kind: 'gift',
      viewer: viewer('1'),
      giftId: '5655',
      giftName: 'Rose',
      coinsEach: 1,
      imageUrl: null,
      count: 1,
      streakTotal: 1,
      streakKey: `k${serial}`,
      streakable: true,
      streakEnded: true,
    };
    return { ...gift, ...fields } as LiveEvent;
  }
  const defaults: Record<string, object> = {
    like: { viewer: viewer('1'), count: 1, roomTotal: null },
    comment: { viewer: viewer('1'), text: 'こんにちは' },
    follow: { viewer: viewer('1') },
    share: { viewer: viewer('1') },
    join: { viewer: viewer('1') },
    subscribe: { viewer: viewer('1'), months: 1 },
    viewers: { count: 10, roomTotal: null },
    streamEnd: {},
  };
  return { ...base, kind, ...defaults[kind], ...fields } as LiveEvent;
}

export function rows<T = Record<string, unknown>>(db: Db, sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function row<T = Record<string, unknown>>(db: Db, sql: string, ...params: Array<string | number | null>): T {
  return db.prepare(sql).get(...params) as T;
}

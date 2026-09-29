// 管理画面に出すための読み出し
// （書き込みは recorder.ts。ここは読むだけ）

import { existsSync, statSync } from 'node:fs';
import { jstDayOf, jstDayRangeUtc } from '../core/time.ts';
import type { Db } from './database.ts';

export interface StreamRow {
  id: number;
  room_id: string;
  is_test: number;
  title: string | null;
  started_at: string;
  started_at_estimated: number;
  ended_at: string | null;
  ended_at_estimated: number;
  duration_sec: number | null;
  last_seen_at: string;
  set_name: string | null;
  max_viewers: number;
  tiktok_total_viewers: number | null;
  visitor_count: number;
  joined_count: number;
  like_count: number;
  tiktok_like_total: number | null;
  comment_count: number;
  gift_count: number;
  coin_total: number;
  follow_count: number;
  share_count: number;
  subscribe_count: number;
  plan_name: string | null;
  memo: string | null;
}

export function listStreams(db: Db, options: { limit?: number; includeTest?: boolean } = {}): StreamRow[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const where = options.includeTest ? '' : 'WHERE is_test = 0';
  return db.prepare(`SELECT * FROM streams ${where} ORDER BY started_at DESC LIMIT ?`).all(limit) as unknown as StreamRow[];
}

export interface DaySummary {
  day: string;
  streams: number;
  durationSec: number;
  coins: number;
  gifts: number;
  likes: number;
  comments: number;
  follows: number;
  visitors: number;
  maxViewers: number;
}

/** 日本時間のある1日の集計（その日に始まった配信。テストは除く） */
export function daySummary(db: Db, nowMs: number, day: string = jstDayOf(nowMs)): DaySummary {
  const { from, to } = jstDayRangeUtc(day);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS streams,
         COALESCE(SUM(COALESCE(duration_sec,
           CAST(ROUND((julianday(:now) - julianday(started_at)) * 86400) AS INTEGER))), 0) AS durationSec,
         COALESCE(SUM(coin_total), 0) AS coins,
         COALESCE(SUM(gift_count), 0) AS gifts,
         COALESCE(SUM(like_count), 0) AS likes,
         COALESCE(SUM(comment_count), 0) AS comments,
         COALESCE(SUM(follow_count), 0) AS follows,
         COALESCE(SUM(visitor_count), 0) AS visitors,
         COALESCE(MAX(max_viewers), 0) AS maxViewers
       FROM streams
       WHERE is_test = 0 AND started_at >= :from AND started_at < :to`,
    )
    .get({ now: new Date(nowMs).toISOString(), from, to }) as unknown as Omit<DaySummary, 'day'>;
  return { day, ...row };
}

export interface Phase0Check {
  stream: StreamRow | null;
  /** 入室の通知が1回以上届いた人 ÷ 何か届いた人（%）。100%に近いほど、入室は全員分届いている */
  joinCoveragePercent: number | null;
  /** 入室の通知が届かなかったのに、コメントなどが届いた人の数 */
  seenWithoutJoin: number;
  counters: Record<string, number>;
}

/** フェーズ0の確認用の数字（最新の配信） */
export function phase0Check(db: Db, counters: Record<string, number>): Phase0Check {
  const stream = (db.prepare('SELECT * FROM streams WHERE is_test = 0 ORDER BY started_at DESC LIMIT 1').get() ??
    null) as StreamRow | null;
  if (!stream) return { stream: null, joinCoveragePercent: null, seenWithoutJoin: 0, counters };
  const row = db
    .prepare(
      `SELECT COUNT(*) AS seen, SUM(CASE WHEN join_count > 0 THEN 1 ELSE 0 END) AS joined
       FROM visits WHERE stream_id = ? AND is_test = 0`,
    )
    .get(stream.id) as { seen: number; joined: number | null };
  const joined = row.joined ?? 0;
  return {
    stream,
    joinCoveragePercent: row.seen > 0 ? Math.round((joined / row.seen) * 1000) / 10 : null,
    seenWithoutJoin: row.seen - joined,
    counters,
  };
}

export interface GiftCatalogRow {
  gift_id: string;
  name: string;
  display_name: string | null;
  coins: number;
  image_url: string | null;
  streakable: number | null;
}

export function giftCatalog(db: Db): GiftCatalogRow[] {
  return db
    .prepare('SELECT gift_id, name, display_name, coins, image_url, streakable FROM gift_catalog ORDER BY coins, name')
    .all() as unknown as GiftCatalogRow[];
}

/**
 * ギフトに自分で付けた表示名を書き込む（要件 R-4）。
 * 空文字を渡すと、自分で付けた名前を消して、TikTokの名前に戻す。
 * まだ一度も来ていないギフトには付けられない（一覧に行がないため）。
 */
export function setGiftDisplayName(db: Db, giftId: string, displayName: string): boolean {
  const value = displayName.trim();
  const result = db
    .prepare('UPDATE gift_catalog SET display_name = ? WHERE gift_id = ?')
    .run(value === '' ? null : value, giftId);
  return Number(result.changes) > 0;
}

export interface RuleRunRow {
  id: number;
  at: string;
  is_test: number;
  rule_name: string;
  trigger_kind: string;
  trigger_detail: string | null;
  actions: string | null;
  result: string;
  message: string | null;
  nickname: string | null;
}

export function recentRuleRuns(db: Db, limit = 30): RuleRunRow[] {
  return db
    .prepare(
      `SELECT r.id, r.at, r.is_test, r.rule_name, r.trigger_kind, r.trigger_detail, r.actions, r.result, r.message, v.nickname
       FROM rule_runs r LEFT JOIN viewers v ON v.viewer_id = r.trigger_viewer_id
       ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit) as unknown as RuleRunRow[];
}

export interface DbInfo {
  file: string;
  bytes: number;
  /** 大きくなりすぎた目安（要件 N-11） */
  tooLarge: boolean;
  schemaVersion: number;
}

const TOO_LARGE_BYTES = 2 * 1024 * 1024 * 1024;

export function dbInfo(db: Db, file: string): DbInfo {
  let bytes = 0;
  for (const f of [file, `${file}-wal`]) {
    if (existsSync(f)) bytes += statSync(f).size;
  }
  const version = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  return { file, bytes, tooLarge: bytes > TOO_LARGE_BYTES, schemaVersion: version };
}

// 配信の記録（要件 6.11）
//
// 届いたイベントをデータベースに書き込む。
// ・書き込みは1秒ごとにまとめて行う（要件 N-1：記録の書き込みで演出を遅らせない）
// ・同じルームIDなら、接続し直しても1つの配信として記録する（要件 D-1）
// ・テストのイベントは「テスト用の配信」（日本時間の日付ごと）に入れ、行にもテストの印を付ける（要件 D-8）
// ・いいねは人ごと・1分ごと、入室は人ごと・配信ごとにまとめる（要件 D-7）
// ・連打ギフトは1行にまとめ、最終的な個数を入れる（二重に数えない）

import type { AreaLogger } from '../core/logger.ts';
import type { LiveEvent, Viewer } from '../core/events.ts';
import { jstDayOf, minuteOf, toIso } from '../core/time.ts';
import { sql, transaction, type Db } from './database.ts';

/** TikTokから分かった配信の情報 */
export interface StreamInfo {
  roomId: string;
  /** 開始時刻（ミリ秒）。分からなければ null（その場合は「推定」の印を付ける） */
  startedAtMs: number | null;
  title: string | null;
}

export interface RuleRunRecord {
  at: string;
  isTest: boolean;
  ruleId: string;
  ruleName: string;
  triggerKind: string;
  triggerViewer: Viewer | null;
  triggerDetail: string | null;
  actions: string[];
  result: 'ok' | 'error' | 'partial' | 'skipped';
  message: string | null;
}

interface CachedViewer {
  uniqueId: string;
  nickname: string;
  followStatus: number | null;
}

const FLUSH_INTERVAL_MS = 1000;
const TOTALS_INTERVAL_MS = 60_000;
const SEEN_MESSAGES_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export class Recorder {
  private readonly db: Db;
  private readonly log: AreaLogger;
  private readonly now: () => number;
  private readonly stmt: ReturnType<typeof prepareStatements>;

  private pending: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  private liveStreamId: number | null = null;
  private liveRoomId: string | null = null;
  private expected: StreamInfo | null = null;
  private liveLastSeenMs = 0;
  private liveDirty = false;
  private lastTotalsMs = 0;
  private warnedNoStream = false;

  private readonly testStreams = new Map<string, number>();
  private readonly viewerCache = new Map<string, CachedViewer>();
  private readonly visited = new Set<string>();
  private readonly catalogSignatures = new Map<string, string>();

  constructor(db: Db, log: AreaLogger, now: () => number = Date.now) {
    this.db = db;
    this.log = log;
    this.now = now;
    this.stmt = prepareStatements(db);
  }

  /** 1秒ごとの書き込みを始める */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
    this.stmt.deleteOldSeen.run(toIso(this.now() - SEEN_MESSAGES_KEEP_MS));
  }

  /** 止める（残っている分は書き込む） */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  get currentStreamId(): number | null {
    return this.liveStreamId;
  }

  get currentRoomId(): string | null {
    return this.liveRoomId ?? this.expected?.roomId ?? null;
  }

  // ───────── 配信の始まりと終わり ─────────

  /** これから接続する配信を知らせる。最初のイベントか接続完了の時に、配信の行を作る */
  expectStream(info: StreamInfo): void {
    if (this.liveRoomId === info.roomId) return;
    if (this.liveStreamId !== null) this.endLiveStream(this.liveLastSeenMs || this.now(), true);
    this.expected = info;
  }

  /** 接続が完了した（TikTokの配信情報で、開始時刻やタイトルを補う） */
  streamConnected(info: StreamInfo): void {
    if (this.liveStreamId !== null && this.liveRoomId !== info.roomId) {
      this.endLiveStream(this.liveLastSeenMs || this.now(), true);
    }
    this.expected = info;
    const id = this.openStream(info);
    this.stmt.updateStreamStart.run(sql(info.startedAtMs === null ? null : toIso(info.startedAtMs)), id);
    this.stmt.updateStreamTitle.run(sql(info.title), id);
  }

  /** TikTokから配信終了の知らせが来た（終了時刻は推定ではない） */
  streamEnded(atMs: number): void {
    this.endLiveStream(atMs, false);
  }

  /** 接続が切れたあと、配信が終わっていると分かった（終了時刻は、最後にデータが届いた時刻で推定） */
  streamOffline(): void {
    this.endLiveStream(this.liveLastSeenMs || this.now(), true);
  }

  /**
   * 前回、本体が途中で止まって「終わっていない」ままの配信を片付ける。
   * 今配信中のルーム（liveRoomId）以外は、最後にデータが届いた時刻で終了（推定）にする。
   */
  reconcileOpenStreams(liveRoomId: string | null): void {
    this.flush();
    const open = this.stmt.selectOpenStreams.all() as Array<{ id: number; room_id: string; last_seen_at: string }>;
    for (const row of open) {
      if (row.room_id === liveRoomId) continue;
      if (row.id === this.liveStreamId) {
        this.endLiveStream(Date.parse(row.last_seen_at), true);
        continue;
      }
      this.stmt.endStream.run(row.last_seen_at, 1, row.last_seen_at, row.id);
      this.recomputeTotals(row.id);
      this.log.info(`終わっていなかった配信（ルームID ${row.room_id}）を、最後にデータが届いた時刻で終了にしました（推定）`);
    }
  }

  private endLiveStream(endMs: number, estimated: boolean): void {
    const id = this.liveStreamId;
    this.expected = null;
    if (id === null) return;
    const endIso = toIso(Math.max(endMs, this.liveLastSeenMs));
    this.flush();
    this.stmt.touchStream.run(endIso, id, endIso);
    this.stmt.endStream.run(endIso, estimated ? 1 : 0, endIso, id);
    this.recomputeTotals(id);
    this.liveStreamId = null;
    this.liveRoomId = null;
    this.liveDirty = false;
    for (const key of this.visited) {
      if (key.startsWith(`${id}:`)) this.visited.delete(key);
    }
    this.log.info(`配信の記録を終了しました（${estimated ? '終了時刻は推定' : 'TikTokからの終了通知'}）`);
  }

  /** 配信の行を用意する（同じルームIDの行があれば、それを使う） */
  private openStream(info: StreamInfo): number {
    if (this.liveStreamId !== null && this.liveRoomId === info.roomId) return this.liveStreamId;
    const nowMs = this.now();
    const row = this.stmt.selectStreamByRoom.get(info.roomId) as
      | { id: number; ended_at: string | null; last_seen_at: string }
      | undefined;
    let id: number;
    if (row) {
      id = row.id;
      if (row.ended_at !== null) this.stmt.reopenStream.run(id);
      this.liveLastSeenMs = Date.parse(row.last_seen_at);
      this.log.info(`前と同じ配信（ルームID ${info.roomId}）なので、続きとして記録します`);
    } else {
      const startedIso = toIso(info.startedAtMs ?? nowMs);
      const result = this.stmt.insertStream.run(
        info.roomId,
        0,
        sql(info.title),
        startedIso,
        info.startedAtMs === null ? 1 : 0,
        toIso(nowMs),
        toIso(nowMs),
      );
      id = Number(result.lastInsertRowid);
      this.liveLastSeenMs = nowMs;
      this.log.info(`新しい配信の記録を始めました（ルームID ${info.roomId}）`);
    }
    this.liveStreamId = id;
    this.liveRoomId = info.roomId;
    this.expected = null;
    this.warnedNoStream = false;
    return id;
  }

  private ensureLiveStream(): number | null {
    if (this.liveStreamId !== null) return this.liveStreamId;
    if (this.expected) return this.openStream(this.expected);
    return null;
  }

  /** テスト用の配信の行（日本時間の日付ごとに1つ） */
  private testStreamId(nowMs: number): number {
    const roomId = `test-${jstDayOf(nowMs)}`;
    const cached = this.testStreams.get(roomId);
    if (cached !== undefined) return cached;
    const row = this.stmt.selectStreamByRoom.get(roomId) as { id: number } | undefined;
    let id: number;
    if (row) {
      id = row.id;
    } else {
      const iso = toIso(nowMs);
      const result = this.stmt.insertStream.run(roomId, 1, 'テスト', iso, 0, iso, iso);
      id = Number(result.lastInsertRowid);
    }
    this.testStreams.set(roomId, id);
    return id;
  }

  // ───────── イベントの記録 ─────────

  handle(event: LiveEvent): void {
    const nowMs = this.now();
    const streamId = event.isTest ? this.testStreamId(nowMs) : this.ensureLiveStream();
    if (streamId === null) {
      if (!this.warnedNoStream) {
        this.log.warn('配信の情報がないまま、イベントが届きました（記録できませんでした）');
        this.warnedNoStream = true;
      }
      return;
    }
    if (!event.isTest) {
      this.liveLastSeenMs = Math.max(this.liveLastSeenMs, nowMs);
      this.liveDirty = true;
    }

    const test = event.isTest ? 1 : 0;
    const viewer = 'viewer' in event ? event.viewer : null;
    if (viewer) this.recordViewer(viewer, streamId, event.at, event.isTest, event.kind === 'join');

    switch (event.kind) {
      case 'gift': {
        if (!event.isTest) this.recordCatalog(event.giftId, event.giftName, event.coinsEach, event.imageUrl, event.streakable);
        const count = Math.max(0, Math.round(event.streakTotal));
        this.queue(() =>
          this.stmt.upsertGift.run(
            streamId,
            sql(viewer?.id),
            test,
            event.at,
            event.at,
            event.giftId,
            event.giftName,
            Math.max(0, Math.round(event.coinsEach)),
            count,
            count * Math.max(0, Math.round(event.coinsEach)),
            event.streakKey,
            event.streakEnded ? 1 : 0,
          ),
        );
        break;
      }
      case 'comment':
        this.queue(() => this.stmt.insertComment.run(streamId, sql(viewer?.id), test, event.at, event.text, sql(event.msgId)));
        break;
      case 'like': {
        if (viewer && event.count > 0) {
          const minute = minuteOf(Date.parse(event.at));
          this.queue(() => this.stmt.upsertLike.run(streamId, viewer.id, minute, test, Math.round(event.count)));
        }
        const total = event.roomTotal;
        if (!event.isTest && total !== null) this.queue(() => this.stmt.updateLikeTotal.run(total, streamId));
        break;
      }
      case 'follow':
      case 'share':
        this.queue(() => this.stmt.insertSocial.run(streamId, sql(viewer?.id), test, event.at, event.kind, null, sql(event.msgId)));
        break;
      case 'subscribe':
        this.queue(() =>
          this.stmt.insertSocial.run(
            streamId,
            sql(viewer?.id),
            test,
            event.at,
            'subscribe',
            sql(event.months === null ? null : `${event.months}か月`),
            sql(event.msgId),
          ),
        );
        break;
      case 'viewers': {
        if (event.isTest) break;
        const minute = minuteOf(Date.parse(event.at));
        const count = Math.max(0, Math.round(event.count));
        const total = event.roomTotal;
        this.queue(() => {
          this.stmt.upsertViewerCount.run(streamId, minute, count, count);
          this.stmt.updateStreamViewers.run(count, sql(total), sql(total), streamId);
        });
        break;
      }
      case 'join':
      case 'streamEnd':
        // 入室は recordViewer で記録済み。配信終了は streamEnded() で扱う
        break;
    }
  }

  /** 視聴者の行・名前の履歴・来場を記録する */
  private recordViewer(viewer: Viewer, streamId: number, at: string, isTest: boolean, isJoin: boolean): void {
    const test = isTest ? 1 : 0;
    let cached = this.viewerCache.get(viewer.id);
    if (!cached) {
      const row = this.stmt.selectViewer.get(viewer.id) as
        | { unique_id: string; nickname: string; follow_status: number | null }
        | undefined;
      if (row) {
        cached = { uniqueId: row.unique_id, nickname: row.nickname, followStatus: row.follow_status };
      } else {
        cached = { uniqueId: viewer.uniqueId, nickname: viewer.nickname, followStatus: viewer.followStatus };
        const v = { ...viewer };
        this.queue(() => {
          this.stmt.insertViewer.run(v.id, test, v.uniqueId, v.nickname, sql(v.avatarUrl), at, at, sql(v.followStatus), v.followStatus === null ? null : at);
          this.stmt.insertViewerName.run(v.id, v.uniqueId, v.nickname, at);
        });
      }
      this.viewerCache.set(viewer.id, cached);
    }

    // 名前が変わっていたら、今の名前を書き換えて履歴に残す（要件 D-3）
    const uniqueId = viewer.uniqueId || cached.uniqueId;
    const nickname = viewer.nickname || cached.nickname;
    if (uniqueId !== cached.uniqueId || nickname !== cached.nickname) {
      cached.uniqueId = uniqueId;
      cached.nickname = nickname;
      this.queue(() => {
        this.stmt.updateViewerNames.run(uniqueId, nickname, viewer.id);
        this.stmt.insertViewerName.run(viewer.id, uniqueId, nickname, at);
      });
    }

    // フォローの状態（分かる範囲で）
    if (viewer.followStatus !== null && viewer.followStatus !== cached.followStatus) {
      cached.followStatus = viewer.followStatus;
      const status = viewer.followStatus;
      this.queue(() => this.stmt.updateFollowStatus.run(status, at, viewer.id));
    }

    const avatar = viewer.avatarUrl;
    this.queue(() => this.stmt.touchViewer.run(at, sql(avatar), viewer.id));

    // 来場（配信ごと・人ごとに1行）
    const visitKey = `${streamId}:${viewer.id}`;
    if (!this.visited.has(visitKey)) {
      this.visited.add(visitKey);
      this.queue(() => {
        const inserted = this.stmt.insertVisit.run(streamId, viewer.id, test, at, at);
        if (Number(inserted.changes) > 0 && !isTest) this.stmt.incStreamCount.run(viewer.id);
      });
    }
    this.queue(() => this.stmt.touchVisit.run(at, streamId, viewer.id));
    if (isJoin) this.queue(() => this.stmt.joinVisit.run(at, streamId, viewer.id));
  }

  private recordCatalog(giftId: string, name: string, coins: number, imageUrl: string | null, streakable: boolean): void {
    if (!giftId || !name) return;
    const signature = `${name}|${coins}|${imageUrl ?? ''}|${streakable}`;
    if (this.catalogSignatures.get(giftId) === signature) return;
    this.catalogSignatures.set(giftId, signature);
    const at = toIso(this.now());
    this.queue(() => this.stmt.upsertGiftCatalog.run(giftId, name, Math.round(coins), sql(imageUrl), streakable ? 1 : 0, at));
  }

  /** ルールの発動を記録する（要件 D-5） */
  recordRuleRun(run: RuleRunRecord): void {
    const streamId = run.isTest ? this.testStreamId(this.now()) : this.ensureLiveStream();
    if (streamId === null) return;
    const viewer = run.triggerViewer;
    if (viewer) this.recordViewer(viewer, streamId, run.at, run.isTest, false);
    this.queue(() =>
      this.stmt.insertRuleRun.run(
        streamId,
        run.isTest ? 1 : 0,
        run.at,
        run.ruleId,
        run.ruleName,
        run.triggerKind,
        sql(viewer?.id),
        sql(run.triggerDetail),
        run.actions.join(','),
        run.result,
        sql(run.message),
      ),
    );
  }

  // ───────── 二重処理の防止（再起動した時用） ─────────

  rememberMessage(msgId: string, at: string): void {
    this.queue(() => this.stmt.insertSeen.run(msgId, at));
  }

  recentMessageIds(sinceMs: number): string[] {
    const rows = this.stmt.selectSeenSince.all(toIso(sinceMs)) as Array<{ msg_id: string }>;
    return rows.map((r) => r.msg_id);
  }

  /**
   * 今の配信で、この連打がすでに何個まで記録されているか。
   * 本体を再起動した直後に、連打の途中から届いた時だけ使う（二重に数えないため）。
   */
  giftStreakBaseline(streakKey: string): { count: number; ended: boolean } | null {
    const streamId = this.ensureLiveStream();
    if (streamId === null) return null;
    const row = this.stmt.selectGiftStreak.get(streamId, streakKey) as { count: number; streak_ended: number } | undefined;
    return row ? { count: row.count, ended: row.streak_ended === 1 } : null;
  }

  // ───────── 書き込み ─────────

  private queue(work: () => void): void {
    this.pending.push(work);
  }

  /** たまっている書き込みを、まとめて行う */
  flush(): void {
    const nowMs = this.now();
    if (this.liveStreamId !== null && this.liveDirty) {
      const id = this.liveStreamId;
      const iso = toIso(this.liveLastSeenMs);
      this.queue(() => this.stmt.touchStream.run(iso, id, iso));
      this.liveDirty = false;
    }
    if (this.liveStreamId !== null && nowMs - this.lastTotalsMs >= TOTALS_INTERVAL_MS) {
      const id = this.liveStreamId;
      this.lastTotalsMs = nowMs;
      this.queue(() => this.recomputeTotals(id));
    }
    if (this.pending.length === 0) return;
    const work = this.pending;
    this.pending = [];
    let failures = 0;
    let lastError: unknown = null;
    try {
      transaction(this.db, () => {
        for (const item of work) {
          try {
            item();
          } catch (err) {
            failures += 1;
            lastError = err;
          }
        }
      });
    } catch (err) {
      this.log.error(`記録の書き込みに失敗しました（${work.length}件）`, err);
      return;
    }
    if (failures > 0) this.log.error(`記録の一部（${failures}件）が書き込めませんでした`, lastError);
  }

  /** 配信の合計（来場者数・コインなど）を、記録から数え直す */
  recomputeTotals(streamId: number): void {
    this.stmt.recomputeTotals.run({ id: streamId });
  }

  // ───────── 視聴者のデータの削除（要件 N-9） ─────────

  /** 特定の視聴者のデータを全部消す（ルールの発動記録は、誰かが分からない形で残す） */
  deleteViewer(viewerId: string): { deleted: boolean; streams: number } {
    this.flush();
    const streams = this.stmt.selectViewerStreams.all(viewerId, viewerId, viewerId, viewerId, viewerId) as Array<{
      stream_id: number;
    }>;
    const result = transaction(this.db, () => this.stmt.deleteViewer.run(viewerId));
    this.viewerCache.delete(viewerId);
    for (const key of this.visited) {
      if (key.endsWith(`:${viewerId}`)) this.visited.delete(key);
    }
    for (const { stream_id } of streams) this.recomputeTotals(stream_id);
    return { deleted: Number(result.changes) > 0, streams: streams.length };
  }
}

function prepareStatements(db: Db) {
  return {
    selectStreamByRoom: db.prepare('SELECT id, ended_at, last_seen_at FROM streams WHERE room_id = ?'),
    insertStream: db.prepare(
      `INSERT INTO streams (room_id, is_test, title, started_at, started_at_estimated, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    reopenStream: db.prepare('UPDATE streams SET ended_at = NULL, ended_at_estimated = 0, duration_sec = NULL WHERE id = ?'),
    updateStreamStart: db.prepare(
      'UPDATE streams SET started_at = ?1, started_at_estimated = 0 WHERE id = ?2 AND started_at_estimated = 1 AND ?1 IS NOT NULL',
    ),
    updateStreamTitle: db.prepare('UPDATE streams SET title = COALESCE(?, title) WHERE id = ?'),
    touchStream: db.prepare('UPDATE streams SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?'),
    endStream: db.prepare(
      `UPDATE streams SET ended_at = ?, ended_at_estimated = ?,
         duration_sec = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400) AS INTEGER))
       WHERE id = ?`,
    ),
    selectOpenStreams: db.prepare('SELECT id, room_id, last_seen_at FROM streams WHERE ended_at IS NULL AND is_test = 0'),

    selectViewer: db.prepare('SELECT unique_id, nickname, follow_status FROM viewers WHERE viewer_id = ?'),
    insertViewer: db.prepare(
      `INSERT OR IGNORE INTO viewers (viewer_id, is_test, unique_id, nickname, avatar_url, first_seen_at, last_seen_at, follow_status, follow_status_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateViewerNames: db.prepare('UPDATE viewers SET unique_id = ?, nickname = ? WHERE viewer_id = ?'),
    insertViewerName: db.prepare(
      'INSERT OR IGNORE INTO viewer_names (viewer_id, unique_id, nickname, first_used_at) VALUES (?, ?, ?, ?)',
    ),
    updateFollowStatus: db.prepare('UPDATE viewers SET follow_status = ?, follow_status_at = ? WHERE viewer_id = ?'),
    touchViewer: db.prepare(
      'UPDATE viewers SET last_seen_at = MAX(last_seen_at, ?), avatar_url = COALESCE(?, avatar_url) WHERE viewer_id = ?',
    ),
    insertVisit: db.prepare(
      'INSERT OR IGNORE INTO visits (stream_id, viewer_id, is_test, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ),
    incStreamCount: db.prepare('UPDATE viewers SET stream_count = stream_count + 1 WHERE viewer_id = ?'),
    touchVisit: db.prepare(
      'UPDATE visits SET last_seen_at = MAX(last_seen_at, ?) WHERE stream_id = ? AND viewer_id = ?',
    ),
    joinVisit: db.prepare(
      `UPDATE visits SET join_count = join_count + 1, first_join_at = COALESCE(first_join_at, ?)
       WHERE stream_id = ? AND viewer_id = ?`,
    ),

    upsertGift: db.prepare(
      `INSERT INTO gifts (stream_id, viewer_id, is_test, at, updated_at, gift_id, gift_name, coins_each, count, coins, streak_key, streak_ended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (stream_id, streak_key) DO UPDATE SET
         count = MAX(gifts.count, excluded.count),
         coins_each = MAX(gifts.coins_each, excluded.coins_each),
         coins = MAX(gifts.count, excluded.count) * MAX(gifts.coins_each, excluded.coins_each),
         updated_at = MAX(gifts.updated_at, excluded.updated_at),
         streak_ended = MAX(gifts.streak_ended, excluded.streak_ended),
         gift_name = CASE WHEN excluded.gift_name <> '' THEN excluded.gift_name ELSE gifts.gift_name END`,
    ),
    selectGiftStreak: db.prepare('SELECT count, streak_ended FROM gifts WHERE stream_id = ? AND streak_key = ?'),
    upsertGiftCatalog: db.prepare(
      `INSERT INTO gift_catalog (gift_id, name, coins, image_url, streakable, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (gift_id) DO UPDATE SET
         name = excluded.name,
         coins = excluded.coins,
         image_url = COALESCE(excluded.image_url, gift_catalog.image_url),
         streakable = COALESCE(excluded.streakable, gift_catalog.streakable),
         updated_at = excluded.updated_at`,
    ),

    insertComment: db.prepare(
      'INSERT OR IGNORE INTO comments (stream_id, viewer_id, is_test, at, text, msg_id) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    upsertLike: db.prepare(
      `INSERT INTO likes (stream_id, viewer_id, minute, is_test, count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (stream_id, viewer_id, minute) DO UPDATE SET count = likes.count + excluded.count`,
    ),
    updateLikeTotal: db.prepare('UPDATE streams SET tiktok_like_total = MAX(COALESCE(tiktok_like_total, 0), ?) WHERE id = ?'),
    insertSocial: db.prepare(
      'INSERT OR IGNORE INTO social (stream_id, viewer_id, is_test, at, kind, detail, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    upsertViewerCount: db.prepare(
      `INSERT INTO viewer_counts (stream_id, minute, viewers, max_viewers) VALUES (?, ?, ?, ?)
       ON CONFLICT (stream_id, minute) DO UPDATE SET
         viewers = excluded.viewers,
         max_viewers = MAX(viewer_counts.max_viewers, excluded.max_viewers)`,
    ),
    updateStreamViewers: db.prepare(
      `UPDATE streams SET
         max_viewers = MAX(max_viewers, ?),
         tiktok_total_viewers = CASE WHEN ? IS NULL THEN tiktok_total_viewers ELSE MAX(COALESCE(tiktok_total_viewers, 0), ?) END
       WHERE id = ?`,
    ),

    insertRuleRun: db.prepare(
      `INSERT INTO rule_runs (stream_id, is_test, at, rule_id, rule_name, trigger_kind, trigger_viewer_id, trigger_detail, actions, result, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),

    insertSeen: db.prepare('INSERT OR IGNORE INTO seen_messages (msg_id, at) VALUES (?, ?)'),
    selectSeenSince: db.prepare('SELECT msg_id FROM seen_messages WHERE at >= ?'),
    deleteOldSeen: db.prepare('DELETE FROM seen_messages WHERE at < ?'),

    recomputeTotals: db.prepare(
      `UPDATE streams SET
         visitor_count = (SELECT COUNT(*) FROM visits WHERE stream_id = :id AND is_test = 0),
         joined_count = (SELECT COUNT(*) FROM visits WHERE stream_id = :id AND is_test = 0 AND join_count > 0),
         like_count = (SELECT COALESCE(SUM(count), 0) FROM likes WHERE stream_id = :id AND is_test = 0),
         comment_count = (SELECT COUNT(*) FROM comments WHERE stream_id = :id AND is_test = 0),
         gift_count = (SELECT COALESCE(SUM(count), 0) FROM gifts WHERE stream_id = :id AND is_test = 0),
         coin_total = (SELECT COALESCE(SUM(coins), 0) FROM gifts WHERE stream_id = :id AND is_test = 0),
         follow_count = (SELECT COUNT(DISTINCT viewer_id) FROM social WHERE stream_id = :id AND is_test = 0 AND kind = 'follow'),
         share_count = (SELECT COUNT(*) FROM social WHERE stream_id = :id AND is_test = 0 AND kind = 'share'),
         subscribe_count = (SELECT COUNT(*) FROM social WHERE stream_id = :id AND is_test = 0 AND kind = 'subscribe'),
         max_viewers = MAX(max_viewers, (SELECT COALESCE(MAX(max_viewers), 0) FROM viewer_counts WHERE stream_id = :id))
       WHERE id = :id`,
    ),

    selectViewerStreams: db.prepare(
      `SELECT stream_id FROM visits WHERE viewer_id = ?
       UNION SELECT stream_id FROM gifts WHERE viewer_id = ?
       UNION SELECT stream_id FROM comments WHERE viewer_id = ?
       UNION SELECT stream_id FROM likes WHERE viewer_id = ?
       UNION SELECT stream_id FROM social WHERE viewer_id = ?`,
    ),
    deleteViewer: db.prepare('DELETE FROM viewers WHERE viewer_id = ?'),
  };
}

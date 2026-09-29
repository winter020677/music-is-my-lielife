// データベースの表の構造と、その移行（要件 N-10）
//
// 表の構造を変える時は、ここに新しい番号の移行を「追加」する。
// すでにある移行は書き換えない（使っているPCのデータベースには、もう適用されているため）。
// 移行の前には、自動でデータベースのバックアップを取る（main.ts 参照）。
// 構造を変えたら docs/database.md も必ず更新する（要件 V-9）。

import { transaction, type Db } from './database.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '最初の表',
    sql: `
-- 配信（1回の配信＝1行。同じルームIDなら、途中で接続し直しても同じ行）
CREATE TABLE streams (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,                 -- TikTokのルームID（テスト用の行は test-日付）
  is_test INTEGER NOT NULL DEFAULT 0,           -- 1＝テストパネルなどで作ったテスト用の配信
  title TEXT,                                   -- 配信のタイトル（分かる時だけ）
  started_at TEXT NOT NULL,                     -- 開始時刻（UTC）
  started_at_estimated INTEGER NOT NULL DEFAULT 0, -- 1＝推定（TikTokから開始時刻が取れなかった）
  ended_at TEXT,                                -- 終了時刻（UTC）。配信中は NULL
  ended_at_estimated INTEGER NOT NULL DEFAULT 0,   -- 1＝推定（本体が途中で止まった等で、最後にデータが届いた時刻）
  duration_sec INTEGER,                         -- 配信時間（秒）
  last_seen_at TEXT NOT NULL,                   -- 最後にデータを受け取った時刻（終了の推定に使う）
  set_name TEXT,                                -- 使ったセット（フェーズ1から）
  max_viewers INTEGER NOT NULL DEFAULT 0,       -- 最大同時視聴者数
  tiktok_total_viewers INTEGER,                 -- TikTokが知らせる累計視聴者数（最大値）
  visitor_count INTEGER NOT NULL DEFAULT 0,     -- 来場者数：何か1つでもデータが届いた人の数（重複なし）
  joined_count INTEGER NOT NULL DEFAULT 0,      -- 入室の通知が届いた人の数（重複なし）
  like_count INTEGER NOT NULL DEFAULT 0,        -- 届いたいいねの合計
  tiktok_like_total INTEGER,                    -- TikTokが知らせるいいねの累計（最大値）
  comment_count INTEGER NOT NULL DEFAULT 0,     -- コメントの数
  gift_count INTEGER NOT NULL DEFAULT 0,        -- ギフトの個数の合計（バラ10連打なら10）
  coin_total INTEGER NOT NULL DEFAULT 0,        -- コインの合計
  follow_count INTEGER NOT NULL DEFAULT 0,      -- 新規フォローの人数（重複なし）
  share_count INTEGER NOT NULL DEFAULT 0,       -- シェアの回数
  subscribe_count INTEGER NOT NULL DEFAULT 0,   -- サブスクの回数
  plan_name TEXT,                               -- 企画名（自分で付けるメモ）
  memo TEXT,                                    -- メモ（自分で付ける）
  created_at TEXT NOT NULL
);
CREATE INDEX streams_started_at ON streams(started_at);

-- 視聴者（1人＝1行。視聴者IDで区別し、名前が変わっても同じ人）
CREATE TABLE viewers (
  viewer_id TEXT PRIMARY KEY,                   -- TikTokの変わらない数字のID（テストは test- で始まる）
  is_test INTEGER NOT NULL DEFAULT 0,
  unique_id TEXT NOT NULL DEFAULT '',           -- 今のユーザー名（@の後ろ）
  nickname TEXT NOT NULL DEFAULT '',            -- 今の表示名
  avatar_url TEXT,
  first_seen_at TEXT NOT NULL,                  -- 初めて来た日時
  last_seen_at TEXT NOT NULL,                   -- 最後に来た日時
  stream_count INTEGER NOT NULL DEFAULT 0,      -- 来た配信の数（テスト用の配信は数えない）
  follow_status INTEGER,                        -- 0＝フォローなし 1＝フォロー中 2＝相互（分かる範囲）
  follow_status_at TEXT,                        -- フォロー状態が分かった時刻
  alias TEXT,                                   -- あだ名（自分で付ける）
  memo TEXT                                     -- メモ（自分で付ける）
);

-- 名前の変更履歴
CREATE TABLE viewer_names (
  viewer_id TEXT NOT NULL REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  unique_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  first_used_at TEXT NOT NULL,                  -- この名前を最初に見た時刻
  PRIMARY KEY (viewer_id, unique_id, nickname)
);

-- 来場（配信ごと・人ごとに1行）
CREATE TABLE visits (
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,                  -- この配信で最初に何か届いた時刻
  last_seen_at TEXT NOT NULL,                   -- この配信で最後に何か届いた時刻
  first_join_at TEXT,                           -- 入室の通知が最初に届いた時刻
  join_count INTEGER NOT NULL DEFAULT 0,        -- 入室の通知が届いた回数
  PRIMARY KEY (stream_id, viewer_id)
);
CREATE INDEX visits_viewer ON visits(viewer_id);

-- ギフト（1回の送信＝1行。連打は1行にまとめ、最終的な個数を入れる）
CREATE TABLE gifts (
  id INTEGER PRIMARY KEY,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_id TEXT REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,                             -- 送られた時刻（連打なら最初の1個）
  updated_at TEXT NOT NULL,                     -- 最後に個数が増えた時刻
  gift_id TEXT NOT NULL,
  gift_name TEXT NOT NULL DEFAULT '',
  coins_each INTEGER NOT NULL DEFAULT 0,        -- 1個あたりのコイン
  count INTEGER NOT NULL DEFAULT 0,             -- 個数
  coins INTEGER NOT NULL DEFAULT 0,             -- コインの合計（coins_each × count）
  streak_key TEXT NOT NULL,                     -- 連打の識別（二重に数えないため）
  streak_ended INTEGER NOT NULL DEFAULT 1,      -- 1＝連打が終わった（または連打できないギフト）
  UNIQUE (stream_id, streak_key)
);
CREATE INDEX gifts_viewer ON gifts(viewer_id);
CREATE INDEX gifts_at ON gifts(at);

-- コメント（1件＝1行）
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_id TEXT REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  msg_id TEXT UNIQUE                            -- TikTokのメッセージID（二重に保存しないため）
);
CREATE INDEX comments_stream ON comments(stream_id);
CREATE INDEX comments_viewer ON comments(viewer_id);

-- いいね（量が多いので、人ごと・1分ごとの合計で保存）
CREATE TABLE likes (
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  minute TEXT NOT NULL,                         -- 1分の区切り（UTC。例 2026-09-29T12:34:00.000Z）
  is_test INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL,
  PRIMARY KEY (stream_id, viewer_id, minute)
);
CREATE INDEX likes_viewer ON likes(viewer_id);

-- フォロー・シェア・サブスク（1回＝1行）
CREATE TABLE social (
  id INTEGER PRIMARY KEY,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_id TEXT REFERENCES viewers(viewer_id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- follow / share / subscribe
  detail TEXT,                                  -- サブスクの月数など
  msg_id TEXT UNIQUE
);
CREATE INDEX social_stream ON social(stream_id);
CREATE INDEX social_viewer ON social(viewer_id);

-- 視聴者数の推移（1分ごと）
CREATE TABLE viewer_counts (
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  minute TEXT NOT NULL,
  viewers INTEGER NOT NULL,                     -- その1分で最後に届いた視聴者数
  max_viewers INTEGER NOT NULL,                 -- その1分の最大
  PRIMARY KEY (stream_id, minute)
);

-- ルールの発動記録（どのルールが、誰の何をきっかけに、いつ動いたか）
CREATE TABLE rule_runs (
  id INTEGER PRIMARY KEY,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,                   -- gift / like / comment など
  trigger_viewer_id TEXT REFERENCES viewers(viewer_id) ON DELETE SET NULL,
  trigger_detail TEXT,                          -- 例：「バラ ×10」
  actions TEXT,                                 -- 動いたやること（overlay,minecraft,speech など）
  result TEXT NOT NULL,                         -- ok / error / partial / skipped
  message TEXT                                  -- エラーの内容など
);
CREATE INDEX rule_runs_stream ON rule_runs(stream_id);

-- ギフトの一覧（届いたギフトから自動で作る）
CREATE TABLE gift_catalog (
  gift_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                           -- TikTokでの名前
  display_name TEXT,                            -- 自分で付けた表示名（日本語名など）
  coins INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  streakable INTEGER,                           -- 1＝連打できるギフト
  updated_at TEXT NOT NULL
);

-- 日ごとの回数（Euler Streamのリクエスト数、配信待ちの確認の回数など）
CREATE TABLE daily_counters (
  day TEXT NOT NULL,                            -- UTCの日付
  key TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, key)
);

-- 処理済みのTikTokメッセージID（本体を再起動した時に、同じメッセージを二重に処理しないため。2日で消す）
CREATE TABLE seen_messages (
  msg_id TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
CREATE INDEX seen_messages_at ON seen_messages(at);
`,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** 今のデータベースの版（まだ何もなければ 0） */
export function currentVersion(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

export function pendingMigrations(db: Db): Migration[] {
  const version = currentVersion(db);
  if (version > LATEST_VERSION) {
    throw new Error(
      `データベースの版（${version}）が、このアプリの版（${LATEST_VERSION}）より新しいです。アプリを最新に更新してください（古いアプリで記録を壊さないために止めました）`,
    );
  }
  return MIGRATIONS.filter((m) => m.version > version);
}

/** まだ適用していない移行を、古い順に1つずつ適用する */
export function migrate(db: Db, now: () => number = Date.now): { from: number; to: number } {
  const from = currentVersion(db);
  for (const migration of pendingMigrations(db)) {
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date(now()).toISOString(),
      );
    });
  }
  return { from, to: currentVersion(db) };
}

# データベースの説明（配信の記録）

配信の記録が「どこに」「どんな形で」入っているかの説明です（要件 V-9）。
Claude Codeに「先月の常連を教えて」などと頼む時は、このファイルを見て調べてもらいます。

> 表の構造を変えた時は、必ずこのファイルも更新する（CLAUDE.md の約束）。
> 今の表の構造：**版1**（`src/server/db/migrations.ts`）

## 場所と開き方

- ファイル：データフォルダの `live.db`（SQLite・1ファイル）
  - Windows：`%LOCALAPPDATA%\TikTokLiveTool\live.db`（例：`C:\Users\あなた\AppData\Local\TikTokLiveTool\live.db`）
  - `.env` に `DATA_DIR=...` を書いた時は、そのフォルダ
  - 管理画面の「記録」→「データのフォルダを開く」でも開ける
- 調べる時は **読み取り専用** で開く。書き換えない（CLAUDE.md の約束）
  ```
  npm run query -- "SELECT * FROM streams ORDER BY started_at DESC LIMIT 5"
  npm run query -- --csv "SELECT ..."    （CSVで出す）
  ```
  `tools/query.ts` は読み取り専用で開くので、記録を壊すことはない。
- バックアップ：毎日1回、`backups` フォルダ（設定で変更可）に `live-年-月-日.db` として作られる。
  表の構造を変える前にも `live-before-v版-….db` が作られる。

## 大事な決まり

1. **時刻はすべてUTC（世界標準時）**で、`2026-09-29T12:34:56.789Z` の形の文字列。
   日本時間にするには `datetime(at, '+9 hours')`、日本時間の日付は `date(at, '+9 hours')`。
2. **テストの印**：`is_test = 1` の行は、テストパネルやテストボタンで作ったもの。
   **分析では必ず `is_test = 0` だけを使う**（配信の表 `streams` にも `is_test` がある）。
   テストのイベントは、日本時間の日付ごとの「テスト用の配信」（`room_id` が `test-2026-09-29` など）に入る。
3. **人の区別は `viewer_id`**（TikTokの変わらない数字のID）。名前（`unique_id`・`nickname`）は変わることがある。
4. **1回の配信 = `streams` の1行**。同じルームIDなら、途中で接続し直しても同じ行。
5. **「推定」の印**：`started_at_estimated = 1` / `ended_at_estimated = 1` の時刻は、TikTokから取れなかったり、
   本体が途中で止まったりして、分かる範囲の時刻（最初・最後にデータが届いた時刻）で入れたもの。
6. **本体が動いていなかった配信は記録されない**（スマホだけで配信した時など）。

## 表の一覧

| 表 | 1行は何か | 主な使い道 |
|---|---|---|
| `streams` | 1回の配信 | 配信の一覧、配信時間、合計（コイン・いいね等） |
| `viewers` | 1人の視聴者 | 視聴者の一覧、初見・常連、最後に来た日 |
| `viewer_names` | 視聴者の名前の履歴 | 名前が変わった人を追う |
| `visits` | 1回の配信 × 1人 | 誰がどの配信に来たか、入室の回数 |
| `gifts` | 1回のギフト送信（連打は1行） | ギフトの集計、トップギフター |
| `comments` | 1件のコメント | コメントの集計、その人の発言 |
| `likes` | 1回の配信 × 1人 × 1分 | いいねの集計、推移 |
| `social` | 1回のフォロー・シェア・サブスク | 新規フォロー、シェア |
| `viewer_counts` | 1回の配信 × 1分 | 視聴者数の推移 |
| `rule_runs` | ルールの1回の発動 | よく動くルール、失敗の確認 |
| `gift_catalog` | ギフトの種類 | ギフトの名前・コイン・画像 |
| `daily_counters` | 1日 × 数えるもの | Euler Streamの使用回数、接続の回数 |
| `seen_messages` | 処理済みのTikTokメッセージ | 二重処理の防止用（分析には使わない。2日で消える） |
| `schema_migrations` | 適用した表の構造の版 | 移行の管理用 |

## 表ごとの説明

### streams（配信）

| 列 | 中身 |
|---|---|
| `id` | 配信の番号（他の表の `stream_id` がこれを指す） |
| `room_id` | TikTokのルームID（テスト用は `test-日付`） |
| `is_test` | 1＝テスト用の配信 |
| `title` | 配信のタイトル（分かる時だけ） |
| `started_at` / `started_at_estimated` | 開始時刻（UTC） / 1＝推定 |
| `ended_at` / `ended_at_estimated` | 終了時刻（UTC。配信中は NULL） / 1＝推定 |
| `duration_sec` | 配信時間（秒） |
| `last_seen_at` | 最後にデータを受け取った時刻 |
| `set_name` | 使ったセット（フェーズ1から） |
| `max_viewers` | 最大同時視聴者数 |
| `tiktok_total_viewers` | TikTokが知らせる累計視聴者数（最大値） |
| `visitor_count` | 来場者数：何か1つでもデータ（入室・コメント・いいね・ギフトなど）が届いた人の数（重複なし） |
| `joined_count` | 入室の通知が届いた人の数（重複なし） |
| `like_count` | 届いたいいねの合計 |
| `tiktok_like_total` | TikTokが知らせるいいねの累計（最大値。取りこぼしがあってもこちらは正確なことが多い） |
| `comment_count` | コメントの数 |
| `gift_count` | ギフトの個数の合計（バラ10連打なら10） |
| `coin_total` | コインの合計 |
| `follow_count` | 新規フォローの人数（重複なし） |
| `share_count` / `subscribe_count` | シェア・サブスクの回数 |
| `plan_name` / `memo` | 企画名・メモ（自分で付ける。フェーズ2で画面から入力） |

合計の列（`visitor_count` 〜 `subscribe_count`）は、配信中は1分ごと・終了時に、下の表から数え直している（テストは除く）。

### viewers（視聴者）

| 列 | 中身 |
|---|---|
| `viewer_id` | TikTokの変わらない数字のID（テストは `test-` で始まる） |
| `is_test` | 1＝テストの視聴者 |
| `unique_id` / `nickname` | 今のユーザー名（@の後ろ）/ 今の表示名 |
| `avatar_url` | アイコンのURL |
| `first_seen_at` / `last_seen_at` | 初めて来た日時 / 最後に来た日時 |
| `stream_count` | 来た配信の数（テスト用の配信は数えない） |
| `follow_status` / `follow_status_at` | 0＝フォローなし 1＝フォロー中 2＝相互（分かる範囲）/ それが分かった時刻 |
| `alias` / `memo` | あだ名・メモ（自分で付ける） |

### viewer_names（名前の履歴）

`viewer_id`, `unique_id`, `nickname`, `first_used_at`（その名前を最初に見た時刻）。

### visits（来場）

| 列 | 中身 |
|---|---|
| `stream_id`, `viewer_id` | どの配信に、誰が |
| `is_test` | 1＝テスト |
| `first_seen_at` / `last_seen_at` | その配信で最初・最後に何か届いた時刻 |
| `first_join_at` / `join_count` | 入室の通知が最初に届いた時刻 / 届いた回数（0なら入室の通知は来ていない） |

### gifts（ギフト）

| 列 | 中身 |
|---|---|
| `stream_id`, `viewer_id`, `is_test` | どの配信で、誰が |
| `at` / `updated_at` | 送られた時刻（連打の最初）/ 最後に個数が増えた時刻 |
| `gift_id` / `gift_name` | ギフトのID / TikTokでの名前 |
| `coins_each` / `count` / `coins` | 1個のコイン / 個数 / コインの合計（= coins_each × count） |
| `streak_key` / `streak_ended` | 連打の識別 / 1＝連打が終わった |

### comments（コメント）

`stream_id`, `viewer_id`, `is_test`, `at`, `text`（本文。改行などの制御文字は取り除いてある）, `msg_id`。

### likes（いいね）

`stream_id`, `viewer_id`, `minute`（1分の区切り。UTC）, `is_test`, `count`（その1分のその人のいいねの合計）。

### social（フォロー・シェア・サブスク）

`stream_id`, `viewer_id`, `is_test`, `at`, `kind`（`follow` / `share` / `subscribe`）, `detail`（サブスクの月数など）, `msg_id`。

### viewer_counts（視聴者数の推移）

`stream_id`, `minute`（1分の区切り。UTC）, `viewers`（その1分で最後に届いた視聴者数）, `max_viewers`（その1分の最大）。

### rule_runs（ルールの発動）

| 列 | 中身 |
|---|---|
| `stream_id`, `is_test`, `at` | どの配信で、いつ |
| `rule_id` / `rule_name` | ルールのID / 名前（フェーズ0は `phase0-gift`「ギフトの反応（フェーズ0の試作）」） |
| `trigger_kind` / `trigger_viewer_id` / `trigger_detail` | きっかけの種類 / 誰の / 内容（例：「Rose ×10」） |
| `actions` | 動いたやること（`overlay`, `minecraft`, `speech` をカンマ区切り） |
| `result` / `message` | `ok` / `partial`（一部失敗）/ `error` / `skipped` と、エラーの内容 |

### gift_catalog（ギフトの一覧）

`gift_id`, `name`, `display_name`（自分で付けた表示名）, `coins`, `image_url`, `streakable`（1＝連打できる）, `updated_at`。届いたギフトから自動で作られる。

### daily_counters（日ごとの回数）

`day`（UTCの日付）, `key`, `count`。主な `key`：

| key | 意味 |
|---|---|
| `euler.〇〇` | Euler Streamへのリクエスト（〇〇は使った処理。`fetchSignedWebSocketFromProvider`＝接続の署名、`fetchRoomIdFromProvider`＝配信中かの確認） |
| `liveCheck.html` / `liveCheck.api` / `liveCheck.euler` / `liveCheck.failed` | 配信待ちの確認（TikTokのページ / TikTokのAPI / Euler Stream / 失敗） |
| `connect.ok` / `connect.failed` / `connect.dropped` / `connect.offline` | 接続できた / 失敗 / 途中で切れた / 配信していなかった |
| `tiktok.duplicate` | 二重に届いたので捨てたメッセージ |

## よく使う調べ方（例）

直近10回の配信（日本時間）：
```sql
SELECT datetime(started_at, '+9 hours') AS 開始, duration_sec / 60 AS 分, max_viewers, visitor_count, coin_total, like_count, follow_count
FROM streams WHERE is_test = 0 ORDER BY started_at DESC LIMIT 10;
```

先月（直近30日）の常連（5回以上来た人）：
```sql
SELECT v.viewer_id, v.nickname, v.unique_id, COUNT(*) AS 来た回数
FROM visits vi JOIN streams s ON s.id = vi.stream_id JOIN viewers v ON v.viewer_id = vi.viewer_id
WHERE vi.is_test = 0 AND s.is_test = 0 AND s.started_at >= datetime('now', '-30 days')
GROUP BY v.viewer_id HAVING COUNT(*) >= 5 ORDER BY 来た回数 DESC;
```

しばらく来ていない常連（全体で5回以上来ていて、14日以上来ていない人）：
```sql
SELECT viewer_id, nickname, stream_count, date(last_seen_at, '+9 hours') AS 最後に来た日
FROM viewers WHERE is_test = 0 AND stream_count >= 5 AND last_seen_at < datetime('now', '-14 days')
ORDER BY last_seen_at DESC;
```

トップギフター（コイン順）：
```sql
SELECT v.nickname, SUM(g.coins) AS コイン, SUM(g.count) AS 個数
FROM gifts g JOIN viewers v ON v.viewer_id = g.viewer_id
WHERE g.is_test = 0 GROUP BY g.viewer_id ORDER BY コイン DESC LIMIT 20;
```

曜日 × 開始時間ごとの平均最大視聴者数：
```sql
SELECT strftime('%w', started_at, '+9 hours') AS 曜日0は日曜, strftime('%H', started_at, '+9 hours') AS 開始時,
       COUNT(*) AS 配信数, ROUND(AVG(max_viewers), 1) AS 平均最大視聴者, ROUND(AVG(coin_total), 1) AS 平均コイン
FROM streams WHERE is_test = 0 GROUP BY 1, 2 ORDER BY 1, 2;
```

1回の配信の中の推移（視聴者数と、1分ごとのいいね）：
```sql
SELECT datetime(vc.minute, '+9 hours') AS 時刻, vc.max_viewers,
       (SELECT COALESCE(SUM(count), 0) FROM likes l WHERE l.stream_id = vc.stream_id AND l.minute = vc.minute AND l.is_test = 0) AS いいね
FROM viewer_counts vc WHERE vc.stream_id = 1 ORDER BY vc.minute;
```

ある人の履歴（名前で探す）：
```sql
SELECT 'ギフト' AS 種類, datetime(g.at, '+9 hours') AS 時刻, g.gift_name || ' ×' || g.count AS 内容 FROM gifts g JOIN viewers v USING (viewer_id)
WHERE v.nickname LIKE '%たろう%' AND g.is_test = 0
UNION ALL
SELECT 'コメント', datetime(c.at, '+9 hours'), c.text FROM comments c JOIN viewers v USING (viewer_id)
WHERE v.nickname LIKE '%たろう%' AND c.is_test = 0
ORDER BY 時刻;
```

## 数字を見る時の注意

- **来場者数**は「データが届いた人の数」。TikTokは入室の通知を全員分送ってこないことがあるので、見ただけで何もしなかった人は数に入らないことがある。
  フェーズ0の確認で、入室の通知がどれくらい届くかを調べる（管理画面の「記録」→「フェーズ0の確認」）。
- **いいね**は、届いた分の合計（`like_count`）と、TikTokが知らせる累計（`tiktok_like_total`）の2つがある。
- **フォローの状態**（`follow_status`）は、その人のデータが届いた時点のもの。

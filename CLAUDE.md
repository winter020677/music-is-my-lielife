# CLAUDE.md

TikTok LIVE配信用の、利用者本人だけが使うツール。STE（StreamToEarn）とLiveSparkの機能を1つにまとめ、月額0円で動かす。配信のデータを貯めて分析にも使う。
仕様はすべて下の要件定義書に従う。

@REQUIREMENTS.md

## 利用者について

- 配信者本人。プログラミングはしない。実装はClaude Codeに任せ、本人は動作確認と設定の移し替えを担当する
- 会話は日本語。専門用語はなるべく使わず、使う時は一言説明を添える
- CSSは自分で調整することがある。値を直接書く書き方を好む（CSS変数の多用は避ける）
- PCはWindows 11。配信ソフトはOBS
- 配信のデータ（配信時間・来た人・ギフトや行動）を分析に使いたい。分析を頼まれたら、データベースを読み取り専用で調べて答える

## 進め方

- 要件定義書のフェーズ順に進める。途中で要件を変えたくなったら、理由を説明して確認を取る
- 区切りごとに、利用者がやること（起動や確認の手順）を番号付きで短く伝える
- 動く状態になるたびにGitでコミットする（Gitが入っていなければ最初に相談する）
- 新しい外部サービスや有料サービスを使いたい時は、必ず先に相談する
- ファイルの削除、Minecraftのワールドやサーバー設定の変更など、取り返しのつかない操作の前は必ず確認する。Minecraftのサーバーフォルダを触る前はバックアップを取る
- 秘密情報（Euler StreamのAPIキー、RCONのパスワード、OBSのパスワード）は .env に置く。コード・ログ・設定の書き出しに出さない。.env はGitに入れない
- 視聴者から来る文字は、必ず無害化してからコマンドや画面に使う（要件定義書 N-4）

## 配信の記録（データベース）の扱い

- 配信の記録は、あとから取り戻せない一番大事なデータ。データベースの削除・作り直し・中身の書き換えの前は、必ず利用者に確認し、先にバックアップを取る
- 表の構造を変える時は、移行の仕組みで既存の記録を引き継ぐ（要件定義書 N-10）
- テストで起きたイベントは「テスト」の印を付け、本番の集計に混ぜない（要件定義書 D-8）
- 表の説明（何がどこに入っているか）は、構造を変えるたびにドキュメントを更新する（要件定義書 V-9）
- 記録を外部のサービスへ送らない（要件定義書 N-9）

## よく使うコマンド

- 初回・更新後のセットアップ（利用者が使う）：`setup.bat`（npm ci → 管理画面のビルド → .env とデスクトップのショートカット作成）
- 更新（利用者が使う）：`update.bat`（git pull → setup.bat）
- 起動（利用者が使う）：デスクトップの「TikTok LIVE ツール」＝ `start.vbs`（コンソールなしで `src/server/main.ts --open`）
- 本体を起動：`npm start`（ファイル変更で自動再起動は `npm run dev`）
- 管理画面を作る：`npm run build`（開発中は `npm run dev:admin` → http://localhost:5173）
- 自動テスト：`npm test`　型チェック：`npm run typecheck`
- 記録を読み取り専用で調べる：`npm run query -- "SELECT ..."`（`--csv` / `--json` も可。表の説明は docs/database.md）
- TikTokにつながらなくなった時：`npm install tiktok-live-connector@latest` → `npm test` → 実際につながるか確認（README の手順）

## コードの地図

- `src/server/main.ts` 起動の入り口 ／ `src/server/app.ts` 各機能の組み立てとイベントの流れ
- `src/server/tiktok/` TikTok接続。ライブラリを使うのは `connectorClient.ts` だけ（要件 N-6）。`normalize.ts` がデータの形をそろえる
  - `liveWatcher.ts` 配信待ち・自動接続・再接続 ／ `eulerUsage.ts` Euler Streamの回数 ／ `giftStreaks.ts` 連打ギフト ／ `pipeline.ts` 二重処理の防止
- `src/server/db/` 記録。表の構造は `migrations.ts`（変える時は新しい版を**追加**し、docs/database.md も更新）。書き込みは `recorder.ts`
- `src/server/actions/` オーバーレイ（WebSocket）・Minecraft（RCON）・読み上げ（VOICEVOX）・アラート
- `src/server/rules/phase0GiftRule.ts` フェーズ0の試作ルール（フェーズ1でルールの仕組みに置き換える）
- `src/server/core/` 置き換え記号（`template.ts`）・無害化（`sanitize.ts`）・順番待ち（`queue.ts`）など
- `src/server/web/server.ts` Webサーバーと管理画面のAPI ／ `src/admin/` 管理画面（React）
- `overlays/` オーバーレイ（素のHTML/CSS/JS。新しいものは `_template` をコピー）
- `tests/` 自動テスト

## 決まったこと（実装で決めたこと）

- 本体の TypeScript はビルドせず、Node.js の型の読み飛ばし（type stripping）でそのまま動かす。Node.js 22.18 以上（LTS の 24 を推奨）。`enum`・`namespace`・コンストラクタ引数のプロパティなど、読み飛ばせない書き方は使わない（tsconfig の `erasableSyntaxOnly`）。相対 import は `.ts` まで書く
- SQLite は Node.js に入っている `node:sqlite` を使う（追加のビルドが要らず、Windowsで npm install が失敗しにくいため）
- データフォルダ（`live.db`・`settings.json`・`logs`・`backups`）は `%LOCALAPPDATA%\TikTokLiveTool`。プロジェクトを消したり取り直したりしても記録が消えないように、プロジェクトの外にした。`.env` の `DATA_DIR` で変更可
- ポートは 3939。管理画面は `http://127.0.0.1:3939/`、オーバーレイは `http://127.0.0.1:3939/overlay/<名前>/`
- 管理画面の「アプリ風の独立ウィンドウ」は、Windows 11 に入っている Edge のアプリモード（`--app`）で開く（要件 U-1）
- 待ち受けは 127.0.0.1 のみ。ログインはないが、Host と Origin を確かめて、他のサイトからの操作を断る
- 時刻はUTCのISO文字列で保存（D-9）。テストのイベントは日本時間の日付ごとの「テスト用の配信」（`room_id = test-日付`）に入れ、行にも `is_test = 1`（D-8）
- 配信待ちの確認は TikTok に直接聞く（Euler Stream を使わない）。直接聞けない時だけ、10分以上空けて Euler Stream に聞く。接続1回で Euler Stream を1回使う（`fetchSignedWebSocketFromProvider`）。今日の使用回数は `daily_counters`（UTCの日付）
- 接続した直後にまとめて届く少し前のデータは、記録するが、60秒以上前のものは演出しない（設定 `records.lateEventSec`）
- 置き換え記号の `{coins}` は「ギフト1個あたりのコイン数」にした。STEの説明（「送られたギフトのコイン数」）では1個あたりか合計かが分からず、利用者も分からないため。合計が欲しい時は `{mult:{coins} {giftcount}}` と書ける。STEのコマンドを移す時に違いが見つかったら直す
- GitHubのリポジトリ名は `tiktok-live-tool`（元は music-is-my-lielife。名前の変更は利用者がGitHubの設定で行う）
- 入室は TikTok の member メッセージの action が 1（入室）か 0（不明）のものを数える
- フェーズ0のギフトの反応は、設定の `phase0.giftReaction`（アラート・Minecraftのコマンド・読み上げ）。フェーズ1でルールの仕組みに移す

## 進み具合

- 要件定義書：v2（配信データの記録と分析を追加）
- 今のフェーズ：フェーズ0（試作）を実装済み。利用者のPCでの確認（短いテスト配信）待ち
  - クラウド上のClaude Codeで作ったため、本物のTikTok・OBS・Minecraft・VOICEVOXとの確認はまだ（にせもののサーバーを使った自動テストと、画面の表示は確認済み）
  - 確認の手順は README の「フェーズ0の確認」。結果（入室の通知が届く割合、Euler Streamの使用回数）を要件定義書のフェーズ0に書き足す
- 決まったこと・分かったことは、このファイルか要件定義書に追記して残す

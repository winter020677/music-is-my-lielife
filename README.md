# music-is-my-lielife

毎日聴いて感動した音楽を記録し、振り返ることができるアプリです。
Spotify APIと連携したレコメンド機能も搭載しています。

## 機能

- 感動した音楽の記録（曲名・アーティスト・気分・お気に入りのパートなど）
- 過去の記録をログで振り返り
- Spotify APIを使った楽曲情報の取得・レコメンド
- 気分グラフ(気分に入力した値を参考に気分の上がり下がりをグラフ化)

## 技術スタック

**バックエンド**
- FastAPI
- SQLAlchemy
- PostgreSQL
- Redis
- Spotipy (Spotify Web API)

**フロントエンド**
- Next.js

**インフラ**
- Docker / Docker Compose

## セットアップ

### 1. 環境変数の設定

`api/.env` を作成し、以下を記載：

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8000/callback
```

### 2. 起動

```bash
docker compose up
```

### 3. APIドキュメント

http://localhost:8000/docs

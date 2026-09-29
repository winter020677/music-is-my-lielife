// TikTokとのやりとりの「形」だけを決めるファイル
// 本物（connectorClient.ts）と、テスト用のにせもの（tests/）が、同じ形で入れ替えられる。

/** 配信中かどうかの確認結果 */
export interface LiveCheckResult {
  live: boolean;
  roomId: string | null;
  /** 配信の開始時刻（分かる時だけ。ミリ秒） */
  startedAtMs: number | null;
  title: string | null;
  /** どの方法で確かめたか：html＝TikTokのページ api＝TikTokのAPI euler＝Euler Stream */
  source: 'html' | 'api' | 'euler';
}

export interface ConnectResult {
  roomId: string;
  startedAtMs: number | null;
  title: string | null;
}

export interface ClientHandlers {
  /** TikTokのイベント（ライブラリのイベント名と、中身そのまま） */
  onEvent(name: string, data: unknown): void;
  /** 接続が切れた */
  onDisconnected(info: { code?: number; reason?: string }): void;
  /** 配信終了の知らせ */
  onStreamEnd(): void;
  /** ライブラリからのエラー（接続は続いていることもある） */
  onError(message: string): void;
}

/** Euler Streamが教えてくれる、残りの回数 */
export interface EulerRateLimits {
  day: { max: number; remaining: number; resetAt: string | null } | null;
  hour: { max: number; remaining: number; resetAt: string | null } | null;
  minute: { max: number; remaining: number; resetAt: string | null } | null;
}

export interface TikTokClient {
  setApiKey(key: string): void;
  /** 配信中か確かめる。allowEuler が false なら Euler Stream は使わない */
  checkLive(username: string, allowEuler: boolean): Promise<LiveCheckResult>;
  /** 配信につなぐ。接続の途中で届くイベントも handlers に来る */
  connect(username: string, roomId: string, handlers: ClientHandlers): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  /** Euler Streamの残り回数を聞く（APIキーがない時は null） */
  fetchRateLimits(): Promise<EulerRateLimits | null>;
}

/** 配信していない（または見つからない）時のエラー */
export class OfflineError extends Error {}

/** Euler Streamの回数制限にかかった時のエラー */
export class RateLimitedError extends Error {
  readonly retryAfterSec: number | null;
  constructor(message: string, retryAfterSec: number | null) {
    super(message);
    this.retryAfterSec = retryAfterSec;
  }
}

// 本体の中で使うイベントの形
// TikTokから届いたデータも、テストパネルで作ったデータも、この形にそろえてから流す。
// こうしておくと、演出・記録・管理画面は「どこから来たか」を気にしなくてよい（要件 U-3）。

export interface Viewer {
  /** 視聴者ID：TikTokの変わらない数字のID（テストの時は test- で始まる）。人の区別には必ずこれを使う */
  id: string;
  /** ユーザー名（@の後ろ。変わることがある） */
  uniqueId: string;
  /** 表示名（変わることがある） */
  nickname: string;
  avatarUrl: string | null;
  /** 配信者との関係（分かる範囲）：0=フォローしていない 1=フォロー中 2=相互 */
  followStatus: number | null;
}

interface EventBase {
  /** 起きた時刻（UTCのISO文字列） */
  at: string;
  /** TikTokのメッセージID（二重に処理しないために使う。テストの時はなし） */
  msgId: string | null;
  /** テストパネルやテストボタンで作ったイベント（要件 D-8） */
  isTest: boolean;
  /** 起きてから時間がたって届いたイベント。記録はするが、演出は出さない */
  late: boolean;
}

export interface GiftEvent extends EventBase {
  kind: 'gift';
  viewer: Viewer | null;
  giftId: string;
  giftName: string;
  /** 1個あたりのコイン数 */
  coinsEach: number;
  imageUrl: string | null;
  /** 今回新しく増えた個数（連打の途中なら差分。0のこともある）。演出はこの数で動かす（要件 C-3） */
  count: number;
  /** 連打をまとめた、ここまでの個数（記録用） */
  streakTotal: number;
  /** 連打の識別。同じ連打なら同じ値 */
  streakKey: string;
  /** 連打できるギフトか */
  streakable: boolean;
  /** 連打が終わったか（連打できないギフトは常に true） */
  streakEnded: boolean;
}

export interface LikeEvent extends EventBase {
  kind: 'like';
  viewer: Viewer | null;
  /** 今回届いたいいねの数（まとめて届く） */
  count: number;
  /** TikTokが知らせる、この配信のいいねの累計（分かる時だけ） */
  roomTotal: number | null;
}

export interface CommentEvent extends EventBase {
  kind: 'comment';
  viewer: Viewer | null;
  text: string;
}

export interface SocialEvent extends EventBase {
  kind: 'follow' | 'share' | 'join';
  viewer: Viewer | null;
}

export interface SubscribeEvent extends EventBase {
  kind: 'subscribe';
  viewer: Viewer | null;
  months: number | null;
}

export interface ViewerCountEvent extends EventBase {
  kind: 'viewers';
  /** 今の視聴者数 */
  count: number;
  /** TikTokが知らせる、この配信の累計視聴者数（分かる時だけ） */
  roomTotal: number | null;
}

export interface StreamEndEvent extends EventBase {
  kind: 'streamEnd';
}

export type LiveEvent =
  | GiftEvent
  | LikeEvent
  | CommentEvent
  | SocialEvent
  | SubscribeEvent
  | ViewerCountEvent
  | StreamEndEvent;

export type LiveEventKind = LiveEvent['kind'];

/** イベントの種類の日本語名（管理画面・ログ用） */
export const EVENT_LABELS: Record<LiveEventKind, string> = {
  gift: 'ギフト',
  like: 'いいね',
  comment: 'コメント',
  follow: 'フォロー',
  share: 'シェア',
  join: '入室',
  subscribe: 'サブスク',
  viewers: '視聴者数',
  streamEnd: '配信終了',
};

export function viewerOf(event: LiveEvent): Viewer | null {
  return 'viewer' in event ? event.viewer : null;
}

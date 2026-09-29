// TikTokから届いたデータを、本体の中の形（core/events.ts）にそろえる
//
// TikTokのデータの形は、ライブラリ（tiktok-live-connector）の更新で変わることがある。
// 形が変わって動かなくなった時は、まずこのファイルを直す（要件 N-6）。

import type { LiveEvent, Viewer } from '../core/events.ts';
import { cleanText } from '../core/sanitize.ts';
import { parseTikTokTime, toIso } from '../core/time.ts';

/** ライブラリのイベント名（WebcastEvent の値） */
export const TIKTOK_EVENT_NAMES = ['chat', 'gift', 'like', 'member', 'follow', 'share', 'roomUser', 'subNotify'] as const;
export type TikTokEventName = (typeof TIKTOK_EVENT_NAMES)[number];

/** 連打の計算をする前のギフト */
export interface RawGift {
  viewer: Viewer | null;
  at: string;
  msgId: string | null;
  late: boolean;
  giftId: string;
  giftName: string;
  coinsEach: number;
  imageUrl: string | null;
  repeatCount: number;
  repeatEnd: boolean;
  groupId: string;
  streakable: boolean;
}

export type Normalized =
  | { type: 'event'; event: LiveEvent }
  | { type: 'gift'; gift: RawGift }
  | { type: 'ignore'; reason: string };

export interface NormalizeOptions {
  nowMs: number;
  /** 接続した直後にまとめて届く「少し前のデータ」か */
  initialBatch: boolean;
  /** これより前に起きたイベントは「遅れて届いた」扱い（初回のまとめて届く分だけ） */
  lateMs: number;
}

// TikTokのデータは深い入れ子で、形も変わりうるので、ここだけは any で受けて慎重に読む
type Raw = any;

export function normalize(name: string, data: Raw, options: NormalizeOptions): Normalized {
  if (!data || typeof data !== 'object') return { type: 'ignore', reason: 'データが空' };
  const createdMs = parseTikTokTime(data.common?.createTime);
  const atMs = createdMs ?? options.nowMs;
  const base = {
    at: toIso(atMs),
    msgId: stringOrNull(data.common?.msgId),
    isTest: false,
    late: options.initialBatch && createdMs !== null && options.nowMs - createdMs > options.lateMs,
  };
  const viewer = viewerFrom(data.user);

  switch (name) {
    case 'gift': {
      const gift: Raw = data.gift ?? data.extendedGiftInfo ?? {};
      const giftId = stringOrNull(data.giftId) ?? stringOrNull(gift.id) ?? '';
      if (!giftId) return { type: 'ignore', reason: 'ギフトIDがない' };
      return {
        type: 'gift',
        gift: {
          ...base,
          viewer,
          giftId,
          giftName: cleanText(gift.name ?? gift.giftName ?? '', 40),
          coinsEach: toInt(gift.diamondCount ?? gift.diamond_count) ?? 0,
          imageUrl: pickImage(gift.image) ?? pickImage(gift.icon),
          repeatCount: toInt(data.repeatCount) ?? 1,
          repeatEnd: data.repeatEnd === true || Number(data.repeatEnd) === 1,
          groupId: stringOrNull(data.groupId) ?? '',
          streakable: Number(gift.type) === 1 || gift.combo === true,
        },
      };
    }
    case 'like':
      return {
        type: 'event',
        event: { ...base, kind: 'like', viewer, count: toInt(data.count) ?? 0, roomTotal: toInt(data.total) },
      };
    case 'chat':
      return { type: 'event', event: { ...base, kind: 'comment', viewer, text: cleanText(data.content, 300) } };
    case 'member': {
      // action：1＝入室。0（不明）も入室として扱う。3（サブスク）などは入室ではない
      const action = Number(data.action ?? 0);
      if (action !== 0 && action !== 1) return { type: 'ignore', reason: `入室以外の member（action=${action}）` };
      return { type: 'event', event: { ...base, kind: 'join', viewer } };
    }
    case 'follow':
      return { type: 'event', event: { ...base, kind: 'follow', viewer } };
    case 'share':
      return { type: 'event', event: { ...base, kind: 'share', viewer } };
    case 'subNotify':
      return { type: 'event', event: { ...base, kind: 'subscribe', viewer, months: toInt(data.subMonth) } };
    case 'roomUser': {
      const count = toInt(data.total);
      if (count === null) return { type: 'ignore', reason: '視聴者数がない' };
      return { type: 'event', event: { ...base, kind: 'viewers', count, roomTotal: toInt(data.totalUser) } };
    }
    default:
      return { type: 'ignore', reason: `扱わないイベント（${name}）` };
  }
}

/** 視聴者の情報を取り出す。視聴者ID（数字のID）が分からない時は null */
export function viewerFrom(user: Raw): Viewer | null {
  if (!user || typeof user !== 'object') return null;
  const id = stringOrNull(user.idStr) ?? stringOrNull(user.id);
  if (!id || id === '0') return null;
  return {
    id,
    uniqueId: cleanText(user.displayId ?? user.uniqueId ?? '', 64),
    nickname: cleanText(user.nickname ?? '', 64),
    avatarUrl: pickImage(user.avatarThumb) ?? pickImage(user.avatarMedium) ?? pickImage(user.avatarLarge),
    followStatus: toInt(user.followInfo?.followStatus),
  };
}

/** 画像の候補から1つ選ぶ（小さめのwebp/jpegを優先） */
function pickImage(image: Raw): string | null {
  const list: unknown = image?.urlList ?? image?.url_list ?? image?.url;
  if (!Array.isArray(list)) return null;
  const urls = list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  return (
    urls.find((u) => u.includes('100x100') && u.includes('.webp')) ??
    urls.find((u) => u.includes('100x100')) ??
    urls[0] ??
    null
  );
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

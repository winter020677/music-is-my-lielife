// 時刻の扱い
// 要件 D-9：データベースには世界標準時（UTC）で保存し、画面では日本時間で表示する。
// 保存する形は ISO 8601 の文字列（例：2026-09-29T12:34:56.789Z）。
// SQLiteの datetime() などの関数でもそのまま使える。

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ミリ秒の時刻 → UTCのISO文字列 */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** 1分ごとの区切り（その分の0秒ちょうど。例：2026-09-29T12:34:00.000Z） */
export function minuteOf(ms: number): string {
  return toIso(Math.floor(ms / MINUTE_MS) * MINUTE_MS);
}

/** UTCの日付（例：2026-09-29） */
export function utcDayOf(ms: number): string {
  return toIso(ms).slice(0, 10);
}

/** 日本時間の日付（例：2026-09-29） */
export function jstDayOf(ms: number): string {
  return toIso(ms + JST_OFFSET_MS).slice(0, 10);
}

/** 日本時間のある1日が、UTCでいつからいつまでか（from以上・to未満） */
export function jstDayRangeUtc(jstDay: string): { from: string; to: string } {
  const start = Date.parse(`${jstDay}T00:00:00.000Z`) - JST_OFFSET_MS;
  return { from: toIso(start), to: toIso(start + DAY_MS) };
}

/** 日本時間の「年-月-日 時:分:秒」（ログやファイル名用） */
export function jstStamp(ms: number): string {
  return toIso(ms + JST_OFFSET_MS).slice(0, 19).replace('T', ' ');
}

/** TikTokから来る時刻（秒・ミリ秒・文字列のどれか）をミリ秒にそろえる。読めなければ null */
export function parseTikTokTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  // 10桁くらいなら秒、13桁くらいならミリ秒
  const ms = n < 1e11 ? n * 1000 : n;
  // 2016年より前や、今から1日以上先の値はおかしいので捨てる
  if (ms < Date.parse('2016-01-01T00:00:00Z') || ms > Date.now() + DAY_MS) return null;
  return Math.round(ms);
}

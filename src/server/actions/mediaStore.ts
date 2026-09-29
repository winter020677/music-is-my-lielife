// 利用者が入れた動画・画像・効果音の置き場（要件 A-1）
//
// ・データフォルダの media フォルダに、そのままのファイルとして置く。
//   プロジェクトを取り直しても（update.bat の git pull）消えないようにするため。
// ・利用者がエクスプローラーでフォルダを開いても分かるように、
//   ファイル名は元の名前をなるべく残す（危ない文字だけ落とし、同じ名前は -2, -3 と付ける）。
// ・一覧はフォルダを読むだけで作る。別の索引ファイルを持たないので、
//   利用者が直接ファイルを入れたり消したりしても食い違わない。

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/** 出せるファイルの種類（要件 A-1：動画・透過webm・GIF・画像・効果音） */
export const MEDIA_KINDS = ['video', 'image', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const EXTENSIONS: Record<string, MediaKind> = {
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.gif': 'image',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.apng': 'image',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
};

export const ALLOWED_EXTENSIONS = Object.keys(EXTENSIONS);

/** 1つあたりの大きさの上限（100MB）。これ以上は配信中に出すには重すぎる */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export interface MediaFile {
  /** ファイル名。そのままオーバーレイのURL（/media/<name>）になる */
  name: string;
  kind: MediaKind;
  bytes: number;
  /** 最後に変わった時刻（UTCのISO文字列） */
  at: string;
}

/** 拡張子から種類を決める。分からない拡張子は null */
export function kindOf(fileName: string): MediaKind | null {
  return EXTENSIONS[extname(fileName).toLowerCase()] ?? null;
}

/**
 * ファイル名を安全にする。
 * ・フォルダをさかのぼる書き方（.. や \ や /）を消す
 * ・Windowsで使えない文字を _ にする
 * ・長すぎる名前は切る
 * 拡張子が扱えないものだった時は null。
 */
export function safeFileName(input: string): string | null {
  const base = input.replace(/^.*[\\/]/, '').trim();
  const ext = extname(base).toLowerCase();
  if (!EXTENSIONS[ext]) return null;

  const stem = base
    .slice(0, base.length - ext.length)
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const safe = (stem === '' ? 'media' : stem).slice(0, 80);
  return `${safe}${ext}`;
}

export class MediaStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  get folder(): string {
    return this.dir;
  }

  /** フォルダがなければ作る */
  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  /** 入っているファイルの一覧（名前順）。扱えない種類のファイルは出さない */
  list(): MediaFile[] {
    if (!existsSync(this.dir)) return [];
    const out: MediaFile[] = [];
    for (const name of readdirSync(this.dir)) {
      const kind = kindOf(name);
      if (!kind) continue;
      try {
        const stat = statSync(join(this.dir, name));
        if (!stat.isFile()) continue;
        out.push({ name, kind, bytes: stat.size, at: new Date(stat.mtimeMs).toISOString() });
      } catch {
        // 読めないファイルは飛ばす
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  /** そのファイルが入っているか（設定に書かれた名前を確かめる時に使う） */
  has(name: string): boolean {
    const safe = safeFileName(name);
    return safe !== null && safe === name && existsSync(join(this.dir, name));
  }

  /**
   * ファイルを入れる。同じ名前があれば「名前-2.mp4」のように番号を付ける。
   * 入れたあとのファイル名を返す。
   */
  save(originalName: string, data: Buffer): MediaFile {
    const safe = safeFileName(originalName);
    if (!safe) {
      throw new Error(`この種類のファイルは入れられません（使えるのは ${ALLOWED_EXTENSIONS.join(' ')}）`);
    }
    if (data.byteLength === 0) throw new Error('ファイルの中身がありません');
    if (data.byteLength > MAX_MEDIA_BYTES) {
      throw new Error(`ファイルが大きすぎます（上限 ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)}MB）`);
    }

    this.ensure();
    const name = this.freeName(safe);
    // 書いている途中のファイルを配信で読み込まないよう、一時ファイルに書いてから名前を変える
    const temp = join(this.dir, `.tmp-${Date.now()}-${name}`);
    writeFileSync(temp, data);
    renameSync(temp, join(this.dir, name));

    const stat = statSync(join(this.dir, name));
    return { name, kind: kindOf(name)!, bytes: stat.size, at: new Date(stat.mtimeMs).toISOString() };
  }

  /** ファイルを消す。消せたら true */
  remove(name: string): boolean {
    if (!this.has(name)) return false;
    rmSync(join(this.dir, name));
    return true;
  }

  /** 空いているファイル名を探す（name.mp4 → name-2.mp4 → name-3.mp4 …） */
  private freeName(safe: string): string {
    if (!existsSync(join(this.dir, safe))) return safe;
    const ext = extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${stem}-${i}${ext}`;
      if (!existsSync(join(this.dir, candidate))) return candidate;
    }
    throw new Error('同じ名前のファイルが多すぎます。名前を変えてから入れてください');
  }
}

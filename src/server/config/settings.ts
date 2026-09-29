// 設定（settings.json）
//
// ・データフォルダの settings.json に1つのファイルで保存する（要件 4. 技術方針）
// ・中身はスキーマ（決まった形）で検査する。おかしな値が1つあっても、
//   その項目だけ初期値に戻して、他の設定は残す
// ・保存は一時ファイル→入れ替えの順で行い、途中で落ちても壊れない（要件 N-3）
// ・毎日1回、backups フォルダにコピーを取る（要件 U-5）
// ・秘密情報はここには入れない（.env に置く）

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../core/fsutil.ts';
import type { AreaLogger } from '../core/logger.ts';
import { jstDayOf } from '../core/time.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 設定のまとまり。形が違う時は空のまとまりとして読み、中の項目は初期値になる */
function section<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((v) => (isPlainObject(v) ? v : {}), z.object(shape));
}
const text = (def: string, max = 2000) => z.string().max(max).catch(def);
const flag = (def: boolean) => z.boolean().catch(def);
const int = (def: number, min: number, max: number) => z.number().int().min(min).max(max).catch(def);
const decimal = (def: number, min: number, max: number) => z.number().min(min).max(max).catch(def);

export const settingsSchema = z.object({
  schemaVersion: z.literal(1).catch(1),

  /** TikTok接続（要件 6.1） */
  tiktok: section({
    /** TikTokのユーザー名（@は付けても付けなくてもよい） */
    username: text('', 100),
    /** 起動したら自動で配信待ちに入る（要件 C-8） */
    autoConnect: flag(true),
    /** 配信待ちの時、配信が始まったかを確かめる間隔（秒） */
    liveCheckIntervalSec: int(60, 30, 3600),
    /** TikTokへの直接の確認が失敗した時、Euler Streamで確かめてよいか */
    eulerFallbackForLiveCheck: flag(true),
    /** ↑でEuler Streamを使う時の最短の間隔（秒）。無料枠を使いすぎないため */
    eulerFallbackMinIntervalSec: int(600, 60, 86400),
    /** Euler Streamの1日の上限（無料のCommunityプランは2,500） */
    eulerDailyLimit: int(2500, 1, 10_000_000),
  }),

  /** Minecraft（要件 6.7） */
  minecraft: section({
    enabled: flag(false),
    host: text('127.0.0.1', 200),
    port: int(25575, 1, 65535),
    /** {playername} に入るプレイヤー名 */
    playerName: text('', 40),
    /** 1秒あたりに送るコマンドの上限（要件 Q-3） */
    maxCommandsPerSecond: int(10, 1, 100),
  }),

  /** 読み上げ（VOICEVOX）（要件 A-4） */
  voicevox: section({
    enabled: flag(false),
    url: text('http://127.0.0.1:50021', 200),
    /** 話者（スタイル）のID。管理画面の一覧から選ぶ */
    speakerId: int(3, 0, 1_000_000),
    speed: decimal(1, 0.5, 2),
    volume: decimal(1, 0, 2),
    pitch: decimal(0, -0.15, 0.15),
    /** 読み上げる最大の文字数 */
    maxChars: int(60, 10, 300),
  }),

  /** アラート用オーバーレイ */
  alert: section({
    /** 1つのアラートを表示する秒数 */
    displaySec: decimal(5, 1, 60),
  }),

  /**
   * フェーズ0の試作用：ギフトが来たら反応する固定のルール。
   * フェーズ1で「ルール」の仕組みができたら、そちらに移す。
   */
  phase0: section({
    giftReaction: section({
      enabled: flag(true),
      /** アラート用オーバーレイに表示する */
      showOnOverlay: flag(true),
      /** Minecraftに送るコマンド（複数行可。空なら送らない） */
      minecraftCommand: text('say {nickname} から {giftname} x{giftcount}', 5000),
      /** 読み上げる文（空なら読まない） */
      speechText: text('{nickname}さん、{giftname}ありがとう', 500),
    }),
  }),

  /** 配信の記録（要件 6.11） */
  records: section({
    /** データベースのバックアップ先フォルダ（空ならデータフォルダの backups） */
    backupFolder: text('', 500),
    /** バックアップを何日分残すか */
    backupKeep: int(14, 1, 365),
    /**
     * 届いた時点で、起きてから何秒以上たっているイベントは「遅れて届いた」扱いにする。
     * 記録はするが、演出は出さない（接続し直した時に、昔のギフトで演出が出ないように）
     */
    lateEventSec: int(60, 5, 3600),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

/** 初期値だけの設定 */
export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/** どんな値でも、正しい形の設定にする（おかしな項目は初期値になる） */
export function normalizeSettings(input: unknown): Settings {
  return settingsSchema.parse(isPlainObject(input) ? input : {});
}

const BACKUP_PREFIX = 'settings-';

export class SettingsStore {
  private readonly file: string;
  private readonly backupDir: string;
  private readonly log: AreaLogger;
  private current: Settings = defaultSettings();
  private readonly listeners = new Set<(next: Settings, prev: Settings) => void>();

  constructor(file: string, backupDir: string, log: AreaLogger) {
    this.file = file;
    this.backupDir = backupDir;
    this.log = log;
  }

  /** 読み込む。ファイルが壊れていたら、壊れたファイルを残したうえで、最新のバックアップから戻す */
  load(): Settings {
    if (!existsSync(this.file)) {
      this.current = defaultSettings();
      this.write(this.current);
      this.log.info('設定ファイルがなかったので、初期値で作りました');
      return this.current;
    }
    try {
      this.current = normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (err) {
      const broken = `${this.file}.broken-${Date.now()}`;
      try {
        renameSync(this.file, broken);
      } catch {
        // 退避できなくても続ける
      }
      this.log.error(`設定ファイルが読めませんでした。壊れたファイルは ${broken} に残しました`, err);
      this.current = this.loadLatestBackup() ?? defaultSettings();
    }
    this.write(this.current);
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  /** 設定をまるごと置き換えて保存する（管理画面の「保存」、設定の読み込み） */
  replace(input: unknown): Settings {
    const prev = this.current;
    const next = normalizeSettings(input);
    this.write(next);
    this.current = next;
    for (const listener of this.listeners) {
      try {
        listener(next, prev);
      } catch (err) {
        this.log.error('設定の反映中にエラーが起きました', err);
      }
    }
    return next;
  }

  onChange(listener: (next: Settings, prev: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 今日の分のバックアップがなければ取る。古いものは keep 個だけ残す */
  dailyBackup(keep: number, now = Date.now()): void {
    try {
      mkdirSync(this.backupDir, { recursive: true });
      const target = join(this.backupDir, `${BACKUP_PREFIX}${jstDayOf(now)}.json`);
      if (!existsSync(target) && existsSync(this.file)) copyFileSync(this.file, target);
      const old = this.listBackups().slice(0, -keep);
      for (const name of old) unlinkSync(join(this.backupDir, name));
    } catch (err) {
      this.log.warn(`設定のバックアップに失敗しました: ${String(err)}`);
    }
  }

  private listBackups(): string[] {
    if (!existsSync(this.backupDir)) return [];
    return readdirSync(this.backupDir)
      .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
      .sort();
  }

  private loadLatestBackup(): Settings | null {
    for (const name of this.listBackups().reverse()) {
      try {
        const restored = normalizeSettings(JSON.parse(readFileSync(join(this.backupDir, name), 'utf8')));
        this.log.warn(`設定をバックアップ ${name} から戻しました`);
        return restored;
      } catch {
        // 次に新しいものを試す
      }
    }
    return null;
  }

  private write(settings: Settings): void {
    writeFileAtomic(this.file, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

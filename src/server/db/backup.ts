// データベースのバックアップ（要件 D-10）
//
// ・毎日1回（日本時間の日付ごと）、バックアップ先フォルダにコピーを作る
// ・SQLiteの「オンラインバックアップ」を使うので、記録中でも壊れないコピーになる
// ・古いものは、設定の「残す日数」だけ残して消す
// ・バックアップ先は設定で変えられる（Googleドライブの同期フォルダなども可）
//   → 指定したフォルダに書けない時は、データフォルダの backups に作る

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { describeError, type AreaLogger } from '../core/logger.ts';
import { jstDayOf, jstStamp } from '../core/time.ts';
import type { Db } from './database.ts';

const DAILY_PATTERN = /^live-\d{4}-\d{2}-\d{2}\.db$/;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface BackupStatus {
  folder: string;
  lastAt: string | null;
  lastFile: string | null;
  lastError: string | null;
  running: boolean;
}

/** データベースを、指定したファイルにコピーする（使用中でも安全） */
export async function copyDatabase(db: Db, file: string): Promise<void> {
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  await backup(db, tmp);
  renameSync(tmp, file);
}

export class BackupManager {
  private readonly db: Db;
  private readonly defaultFolder: string;
  private readonly getFolder: () => string;
  private readonly getKeep: () => number;
  private readonly log: AreaLogger;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private state: BackupStatus;

  constructor(options: {
    db: Db;
    defaultFolder: string;
    getFolder: () => string;
    getKeep: () => number;
    log: AreaLogger;
    now?: () => number;
  }) {
    this.db = options.db;
    this.defaultFolder = options.defaultFolder;
    this.getFolder = options.getFolder;
    this.getKeep = options.getKeep;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.state = { folder: this.folder(), lastAt: null, lastFile: null, lastError: null, running: false };
  }

  /** 起動時と、1時間ごとに「今日の分があるか」を確かめる */
  start(): void {
    void this.runIfNeeded();
    this.timer = setInterval(() => void this.runIfNeeded(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): BackupStatus {
    return { ...this.state, folder: this.folder() };
  }

  folder(): string {
    const custom = this.getFolder().trim();
    return custom || this.defaultFolder;
  }

  async runIfNeeded(): Promise<void> {
    const name = `live-${jstDayOf(this.now())}.db`;
    const folder = this.folder();
    if (existsSync(join(folder, name))) {
      if (!this.state.lastFile) this.noteExisting(folder);
      return;
    }
    await this.run(name);
  }

  /** 今すぐバックアップを取る（管理画面のボタン用） */
  async runNow(): Promise<string | null> {
    const stamp = jstStamp(this.now()).replace(/[-: ]/g, '').slice(0, 14);
    return this.run(`live-manual-${stamp}.db`);
  }

  private async run(name: string): Promise<string | null> {
    if (this.state.running) return null;
    this.state.running = true;
    let folder = this.folder();
    try {
      try {
        mkdirSync(folder, { recursive: true });
      } catch (err) {
        this.log.warn(`バックアップ先 ${folder} に書けないので、${this.defaultFolder} に作ります: ${describeError(err)}`);
        folder = this.defaultFolder;
        mkdirSync(folder, { recursive: true });
      }
      const file = join(folder, name);
      await copyDatabase(this.db, file);
      this.prune(folder);
      this.state = { ...this.state, lastAt: new Date(this.now()).toISOString(), lastFile: file, lastError: null };
      this.log.info(`データベースのバックアップを作りました: ${file}`);
      return file;
    } catch (err) {
      this.state = { ...this.state, lastError: describeError(err) };
      this.log.error('データベースのバックアップに失敗しました', err);
      return null;
    } finally {
      this.state.running = false;
    }
  }

  /** 毎日のバックアップを、新しいものから keep 個だけ残す（手動・移行前のものは消さない） */
  private prune(folder: string): void {
    const keep = Math.max(1, this.getKeep());
    const daily = readdirSync(folder)
      .filter((name) => DAILY_PATTERN.test(name))
      .sort();
    for (const name of daily.slice(0, Math.max(0, daily.length - keep))) {
      rmSync(join(folder, name), { force: true });
    }
  }

  private noteExisting(folder: string): void {
    try {
      const latest = readdirSync(folder)
        .filter((name) => DAILY_PATTERN.test(name))
        .sort()
        .pop();
      if (!latest) return;
      const file = join(folder, latest);
      this.state = { ...this.state, lastFile: file, lastAt: new Date(statSync(file).mtimeMs).toISOString() };
    } catch {
      // 分からなくても困らない
    }
  }
}

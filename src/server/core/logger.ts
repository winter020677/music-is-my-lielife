// ログ（動作の記録）
// ・データフォルダの logs に、日本時間の日付ごとのファイルで保存する（例：app-2026-09-29.log）
// ・秘密情報（APIキー・パスワード）は、万一ログに混ざっても *** に置き換える
// ・最近の注意・エラーは管理画面にも表示する
// 困った時は、このログファイルをClaude Codeに見せると原因を調べやすい。

import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { jstDayOf, jstStamp } from './time.ts';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  area: string;
  message: string;
}

export interface AreaLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

const KEEP_LOG_DAYS = 14;
const RECENT_LIMIT = 100;

export class Logger {
  private dir: string | null = null;
  private secrets: string[] = [];
  private readonly recent: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly toConsole: boolean;

  constructor(options: { toConsole?: boolean } = {}) {
    this.toConsole = options.toConsole ?? true;
  }

  /** ログファイルを書く場所を決める（古いログは消す） */
  setDirectory(dir: string): void {
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.removeOldFiles();
  }

  /** ログに出してはいけない文字（秘密情報）を登録する */
  setSecrets(values: Array<string | undefined>): void {
    this.secrets = values.filter((v): v is string => typeof v === 'string' && v.length >= 4);
  }

  area(name: string): AreaLogger {
    return {
      info: (message) => this.write('info', name, message),
      warn: (message) => this.write('warn', name, message),
      error: (message, err) => this.write('error', name, err === undefined ? message : `${message}: ${describeError(err)}`),
    };
  }

  /** 最近の注意・エラー（新しい順） */
  recentProblems(): LogEntry[] {
    return [...this.recent].reverse();
  }

  onEntry(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(level: LogLevel, area: string, rawMessage: string): void {
    const now = Date.now();
    const message = this.mask(rawMessage);
    const entry: LogEntry = { at: new Date(now).toISOString(), level, area, message };
    const line = `${jstStamp(now)} [${level.toUpperCase()}] [${area}] ${message}`;

    if (this.toConsole) {
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
    if (this.dir) {
      try {
        appendFileSync(join(this.dir, `app-${jstDayOf(now)}.log`), `${line}\n`, 'utf8');
      } catch {
        // ログが書けなくても本体は止めない
      }
    }
    if (level !== 'info') {
      this.recent.push(entry);
      if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 管理画面への通知の失敗は無視する
      }
    }
  }

  private mask(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      out = out.split(secret).join('***');
    }
    return out;
  }

  private removeOldFiles(): void {
    if (!this.dir) return;
    const limit = Date.now() - KEEP_LOG_DAYS * 24 * 60 * 60 * 1000;
    try {
      for (const name of readdirSync(this.dir)) {
        if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const file = join(this.dir, name);
        if (statSync(file).mtimeMs < limit) unlinkSync(file);
      }
    } catch {
      // 消せなくても困らない
    }
  }
}

/** エラーを1行の文章にする */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause ? `${err.message}（原因：${describeError(cause)}）` : err.message;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** テストなどで使う、何も出力しないロガー */
export function silentLogger(): Logger {
  return new Logger({ toConsole: false });
}

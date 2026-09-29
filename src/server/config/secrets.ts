// 秘密情報（.env ファイル）
//
// Euler StreamのAPIキー、RCONのパスワード、OBSのパスワードは、プロジェクトの .env に置く。
// ・.env はGitに入らない（.gitignore で除外）
// ・管理画面から書き換えられるが、管理画面に値そのものは返さない（「設定済み」かどうかだけ）
// ・ログには出さない（ロガーが *** に置き換える）

import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../core/fsutil.ts';

export const SECRET_KEYS = ['EULER_API_KEY', 'MINECRAFT_RCON_PASSWORD', 'OBS_WEBSOCKET_PASSWORD'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** 秘密ではないが .env で変えられる値 */
export const OTHER_ENV_KEYS = ['PORT', 'DATA_DIR'] as const;

type EnvValues = Record<string, string>;

/** .env の中身を読む（# で始まる行はメモとして無視） */
export function parseEnv(text: string): EnvValues {
  const values: EnvValues = {};
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** .env の中身を書き換える（他の行やメモはそのまま残す） */
export function updateEnvText(text: string, updates: Record<string, string>): string {
  const lines = text.length > 0 ? text.replace(/^﻿/, '').split(/\r?\n/) : [];
  const done = new Set<string>();
  const out = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return rawLine;
    const eq = line.indexOf('=');
    if (eq <= 0) return rawLine;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!(key in updates)) return rawLine;
    done.add(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  for (const [key, value] of Object.entries(updates)) {
    if (!done.has(key)) out.push(`${key}=${formatEnvValue(value)}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * 値を .env に書く形にする。
 * 読む側（parseEnv）は「前後が同じ引用符なら外す」だけなので、
 * 前後に空白がある時や、引用符で囲まれて見える時だけ、中に無い方の引用符で囲む。
 */
function formatEnvValue(value: string): string {
  const clean = value.replace(/[\r\n]/g, '');
  const looksQuoted = clean.length >= 2 && (clean[0] === '"' || clean[0] === "'") && clean[0] === clean[clean.length - 1];
  if (!/^\s|\s$/.test(clean) && !looksQuoted) return clean;
  return clean.includes("'") ? `"${clean}"` : `'${clean}'`;
}

export class SecretStore {
  private readonly file: string;
  private values: EnvValues = {};
  private readonly listeners = new Set<(changed: SecretKey[]) => void>();

  constructor(file: string) {
    this.file = file;
  }

  load(): void {
    this.values = existsSync(this.file) ? parseEnv(readFileSync(this.file, 'utf8')) : {};
  }

  get(key: SecretKey | (typeof OTHER_ENV_KEYS)[number]): string {
    return this.values[key]?.trim() ?? '';
  }

  /** 設定されているかどうかだけを返す（管理画面用） */
  status(): Record<SecretKey, boolean> {
    return {
      EULER_API_KEY: this.get('EULER_API_KEY') !== '',
      MINECRAFT_RCON_PASSWORD: this.get('MINECRAFT_RCON_PASSWORD') !== '',
      OBS_WEBSOCKET_PASSWORD: this.get('OBS_WEBSOCKET_PASSWORD') !== '',
    };
  }

  allSecretValues(): string[] {
    return SECRET_KEYS.map((key) => this.get(key)).filter((v) => v !== '');
  }

  /** 秘密情報を書き換えて .env に保存する。空文字を渡すと消す */
  update(updates: Partial<Record<SecretKey, string>>): SecretKey[] {
    const changed: SecretKey[] = [];
    const toWrite: Record<string, string> = {};
    for (const key of SECRET_KEYS) {
      const value = updates[key];
      if (value === undefined) continue;
      const clean = value.replace(/[\r\n]/g, '').trim();
      if (clean === this.get(key)) continue;
      toWrite[key] = clean;
      changed.push(key);
    }
    if (changed.length === 0) return changed;
    const current = existsSync(this.file) ? readFileSync(this.file, 'utf8') : '';
    writeFileAtomic(this.file, updateEnvText(current, toWrite));
    this.load();
    for (const listener of this.listeners) listener(changed);
    return changed;
  }

  onChange(listener: (changed: SecretKey[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

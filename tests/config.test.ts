// 設定（settings.json）と秘密情報（.env）のテスト
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore, parseEnv, updateEnvText } from '../src/server/config/secrets.ts';
import { SettingsStore, defaultSettings, normalizeSettings } from '../src/server/config/settings.ts';
import { log } from './helpers.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tlt-test-'));
}

describe('設定', () => {
  it('何もなければ初期値', () => {
    const s = defaultSettings();
    expect(s.tiktok.autoConnect).toBe(true);
    expect(s.tiktok.eulerDailyLimit).toBe(2500);
    expect(s.minecraft.port).toBe(25575);
    expect(s.voicevox.url).toBe('http://127.0.0.1:50021');
  });

  it('おかしな値は、その項目だけ初期値に戻し、他は残す', () => {
    const s = normalizeSettings({
      tiktok: { username: 'abc', liveCheckIntervalSec: 5, autoConnect: 'yes' },
      minecraft: 'こわれた',
      unknown: 1,
    });
    expect(s.tiktok.username).toBe('abc');
    expect(s.tiktok.liveCheckIntervalSec).toBe(60);
    expect(s.tiktok.autoConnect).toBe(true);
    expect(s.minecraft.port).toBe(25575);
    expect('unknown' in s).toBe(false);
  });

  it('ファイルがなければ作り、保存した内容を次回も読める', () => {
    const dir = tempDir();
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file, join(dir, 'backups'), log);
    store.load();
    const next = store.get();
    next.tiktok.username = 'my_account';
    store.replace(next);
    const again = new SettingsStore(file, join(dir, 'backups'), log);
    expect(again.load().tiktok.username).toBe('my_account');
  });

  it('壊れたファイルは残して、最新のバックアップから戻す', () => {
    const dir = tempDir();
    const file = join(dir, 'settings.json');
    const backups = join(dir, 'backups');
    const store = new SettingsStore(file, backups, log);
    store.load();
    store.replace({ ...store.get(), tiktok: { ...store.get().tiktok, username: 'from_backup' } });
    store.dailyBackup(7);
    writeFileSync(file, '{ これはJSONではない');
    const restored = new SettingsStore(file, backups, log).load();
    expect(restored.tiktok.username).toBe('from_backup');
    expect(readdirSync(dir).some((n) => n.startsWith('settings.json.broken-'))).toBe(true);
  });

  it('変更を知らせる', () => {
    const dir = tempDir();
    const store = new SettingsStore(join(dir, 'settings.json'), join(dir, 'b'), log);
    store.load();
    const seen: string[] = [];
    store.onChange((next, prev) => seen.push(`${prev.tiktok.username}→${next.tiktok.username}`));
    store.replace({ ...store.get(), tiktok: { ...store.get().tiktok, username: 'x' } });
    expect(seen).toEqual(['→x']);
  });
});

describe('秘密情報（.env）', () => {
  it('読み書き：メモや他の行は残す', () => {
    const text = '# メモ\nPORT=3939\nEULER_API_KEY=old\n';
    expect(parseEnv(text)).toEqual({ PORT: '3939', EULER_API_KEY: 'old' });
    expect(updateEnvText(text, { EULER_API_KEY: 'new', MINECRAFT_RCON_PASSWORD: 'pw' })).toBe(
      '# メモ\nPORT=3939\nEULER_API_KEY=new\nMINECRAFT_RCON_PASSWORD=pw\n',
    );
  });

  it('引用符で囲まれた値、前後の空白、改行の入った値', () => {
    expect(parseEnv('A="x y"\nB=\'z\'\n')).toEqual({ A: 'x y', B: 'z' });
    expect(parseEnv(updateEnvText('', { A: ' pad ' }))).toEqual({ A: ' pad ' });
    expect(updateEnvText('', { A: 'a\nB=evil' })).toBe('A=aB=evil\n');
  });

  it('保存すると .env に書かれ、状態は「設定済み」かどうかだけ返す', () => {
    const dir = tempDir();
    const file = join(dir, '.env');
    const store = new SecretStore(file);
    store.load();
    expect(store.status().EULER_API_KEY).toBe(false);
    const changed = store.update({ EULER_API_KEY: 'euler_abc123' });
    expect(changed).toEqual(['EULER_API_KEY']);
    expect(store.status()).toEqual({ EULER_API_KEY: true, MINECRAFT_RCON_PASSWORD: false, OBS_WEBSOCKET_PASSWORD: false });
    expect(readFileSync(file, 'utf8')).toContain('EULER_API_KEY=euler_abc123');
    expect(store.update({ EULER_API_KEY: 'euler_abc123' })).toEqual([]);
  });
});

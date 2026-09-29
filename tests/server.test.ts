// 本体のWebサーバーのテスト（本物の App を、にせのTikTokで動かす）
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/server/app.ts';
import { resolvePaths } from '../src/server/config/paths.ts';
import { silentLogger } from '../src/server/core/logger.ts';
import type { TikTokClient } from '../src/server/tiktok/client.ts';
import { createWebServer } from '../src/server/web/server.ts';

const PORT = 39399;
const HOST = `127.0.0.1:${PORT}`;

const fakeClient: TikTokClient = {
  setApiKey() {},
  async checkLive() {
    return { live: false, roomId: null, startedAtMs: null, title: null, source: 'html' };
  },
  async connect() {
    throw new Error('テストではつながない');
  },
  async disconnect() {},
  async fetchRateLimits() {
    return null;
  },
};

let app: App;
let server: Awaited<ReturnType<typeof createWebServer>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tlt-server-'));
  const paths = { ...resolvePaths(join(dir, 'data')), envFile: join(dir, '.env') };
  app = await App.create({ paths, logger: silentLogger(), port: PORT, client: fakeClient });
  server = await createWebServer(app);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await app.stop();
});

function inject(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, headers: Record<string, string> = {}) {
  return server.inject({
    method,
    url,
    headers: { host: HOST, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Webサーバー', () => {
  it('ping', async () => {
    const res = await inject('GET', '/api/ping');
    expect(res.json()).toMatchObject({ app: 'tiktok-live-tool' });
  });

  it('他のアドレス（Host）からのアクセスは断る', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/state', headers: { host: 'evil.example:80' } });
    expect(res.statusCode).toBe(403);
  });

  it('他のページ（Origin）からの操作は断る', async () => {
    const res = await inject('POST', '/api/overlays/reload', {}, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    const ok = await inject('POST', '/api/overlays/reload', {}, { origin: `http://${HOST}` });
    expect(ok.statusCode).toBe(200);
  });

  it('状態を返す（秘密情報の値は含めない）', async () => {
    await inject('PUT', '/api/secrets', { EULER_API_KEY: 'super-secret-key' });
    const res = await inject('GET', '/api/state');
    expect(res.body).not.toContain('super-secret-key');
    expect(res.json().secrets.EULER_API_KEY).toBe(true);
  });

  it('テストのギフトは、テストの印を付けて記録する', async () => {
    const res = await inject('POST', '/api/test/event', { kind: 'gift', name: 'テスト太郎', giftName: 'バラ', coins: 1, count: 3 });
    expect(res.json()).toMatchObject({ ok: true, event: { kind: 'gift', isTest: true, count: 3 } });
    app.recorder.flush();
    const streams = (await inject('GET', '/api/records/streams?includeTest=1')).json().streams as Array<{ is_test: number }>;
    expect(streams).toHaveLength(1);
    expect(streams[0].is_test).toBe(1);
    const real = (await inject('GET', '/api/records/streams')).json().streams;
    expect(real).toHaveLength(0);
  });

  it('入力の形がおかしい時は 400', async () => {
    const res = await inject('POST', '/api/test/event', { kind: 'unknown' });
    expect(res.statusCode).toBe(400);
  });

  it('設定を保存すると、正しい形にして返す', async () => {
    const state = (await inject('GET', '/api/state')).json();
    const settings = { ...state.settings, tiktok: { ...state.settings.tiktok, username: 'abc', liveCheckIntervalSec: 1 } };
    const res = await inject('PUT', '/api/settings', settings);
    expect(res.json().settings.tiktok).toMatchObject({ username: 'abc', liveCheckIntervalSec: 60 });
  });

  it('設定の書き出しには秘密情報が入らない', async () => {
    const res = await inject('GET', '/api/settings/export');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).not.toContain('super-secret-key');
  });

  it('オーバーレイと管理画面のファイルを配る', async () => {
    const overlay = await inject('GET', '/overlay/alert/');
    expect(overlay.statusCode).toBe(200);
    expect(overlay.body).toContain('alert-template');
    const common = await inject('GET', '/overlay/common/overlay-client.js');
    expect(common.body).toContain('connectOverlay');
  });

  it('順番待ちの操作', async () => {
    expect((await inject('POST', '/api/queues/minecraft/pause', {})).json().queue.paused).toBe(true);
    expect((await inject('POST', '/api/queues/minecraft/resume', {})).json().queue.paused).toBe(false);
    expect((await inject('POST', '/api/queues/nothing/pause', {})).statusCode).toBe(404);
  });

  it('Minecraftサーバー：フォルダが未設定なら起動できず、理由を返す（要件 M-3）', async () => {
    const res = await inject('POST', '/api/minecraft/server/start', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('サーバーのフォルダが未設定です');
    expect((await inject('GET', '/api/state')).json().minecraft.server).toMatchObject({ state: 'stopped', configured: false });
    expect((await inject('POST', '/api/minecraft/server/console', { line: 'list' })).json().error).toContain('動いていません');
    expect((await inject('GET', '/api/minecraft/server/console')).json().lines).toEqual([]);
    expect((await inject('POST', '/api/minecraft/server/stop', {})).json()).toEqual({ ok: true });
  });
});

// 本体のWebサーバー（管理画面・オーバーレイ・API）
//
// ・待ち受けは 127.0.0.1 だけ。LANや外部からは見えない（要件 3.）
// ・ログインは無いが、他のWebサイトからこっそり操作されないように、
//   「Host」と「Origin」（どのページからのアクセスか）を確かめて、自分のページ以外は断る

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { ALLOWED_EXTENSIONS, MAX_MEDIA_BYTES } from '../actions/mediaStore.ts';
import { OVERLAY_NAME_PATTERN } from '../actions/overlayHub.ts';
import type { App } from '../app.ts';
import { SECRET_KEYS } from '../config/secrets.ts';
import { describeError } from '../core/logger.ts';
import { dbInfo, giftCatalog, listStreams, phase0Check, setGiftDisplayName } from '../db/queries.ts';

export const HOST = '127.0.0.1';

export async function createWebServer(app: App): Promise<FastifyInstance> {
  const port = app.port;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const server = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  // 他のサイトからのアクセスを断る
  server.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts.has(host)) {
      return reply.code(403).send({ error: 'このアドレスからは使えません' });
    }
    const origin = req.headers.origin;
    const changesSomething = req.method !== 'GET' && req.method !== 'HEAD';
    const isWebSocket = req.headers.upgrade?.toLowerCase() === 'websocket';
    if (origin && (changesSomething || isWebSocket) && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: 'ほかのページからは操作できません' });
    }
    return undefined;
  });

  // メディアのアップロードは、ファイルの中身をそのまま送ってもらう（multipart を使わない）
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  await server.register(fastifyWebsocket);

  // ───── WebSocket（リアルタイムの知らせ） ─────
  server.get('/ws/admin', { websocket: true }, (socket) => {
    app.addAdminSocket(socket);
  });

  server.get('/ws/overlay', { websocket: true }, (socket, req) => {
    const name = String((req.query as { name?: string }).name ?? '');
    if (!OVERLAY_NAME_PATTERN.test(name)) {
      socket.close(1008, 'bad overlay name');
      return;
    }
    app.addOverlaySocket(name, socket);
  });

  // ───── オーバーレイ（OBSのブラウザソース） ─────
  await server.register(fastifyStatic, {
    root: app.paths.overlaysDir,
    prefix: '/overlay/',
    redirect: true,
    index: ['index.html'],
    cacheControl: false,
  });

  // ───── メディア（利用者が入れた動画・画像・音。要件 A-1） ─────
  app.mediaStore.ensure();
  await server.register(fastifyStatic, {
    root: app.paths.mediaDir,
    prefix: '/media/',
    decorateReply: false,
    cacheControl: false,
    // フォルダの中身を一覧で見せない
    index: false,
    list: false,
  });

  // ───── 管理画面 ─────
  if (existsSync(app.paths.adminDist)) {
    await server.register(fastifyStatic, {
      root: app.paths.adminDist,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
    });
  } else {
    server.get('/', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><meta charset="utf-8"><title>準備が必要です</title><body style="font-family:sans-serif;padding:40px">' +
            '<h1>管理画面がまだ作られていません</h1><p>プロジェクトのフォルダの <b>setup.bat</b> を実行してから、もう一度開いてください。</p>',
        ),
    );
  }

  // ───── API ─────
  server.get('/api/ping', async () => ({ app: 'tiktok-live-tool', version: app.version }));
  server.get('/api/state', async () => app.state());

  // TikTok
  server.post('/api/tiktok/connect', async () => {
    await app.watcher.connectNow();
    return { ok: true };
  });
  server.post('/api/tiktok/disconnect', async () => {
    await app.watcher.disconnectNow();
    return { ok: true };
  });
  server.post('/api/tiktok/rate-limits', async () => {
    await app.watcher.refreshRateLimits();
    return { ok: true, euler: app.euler.snapshot() };
  });

  // テストパネル（要件 U-3）
  const testEventSchema = z.object({
    kind: z.enum(['gift', 'like', 'comment', 'follow', 'share', 'join', 'subscribe']),
    name: z.string().max(64).default('テスト視聴者'),
    giftId: z.string().max(64).optional(),
    giftName: z.string().max(64).optional(),
    coins: z.number().int().min(0).max(1_000_000).optional(),
    count: z.number().int().min(1).max(1000).optional(),
    text: z.string().max(300).optional(),
  });
  server.post('/api/test/event', async (req, reply) => {
    const input = parse(testEventSchema, req.body, reply);
    if (!input) return reply;
    let imageUrl: string | null = null;
    let { giftName, coins } = input;
    if (input.kind === 'gift' && input.giftId) {
      const known = giftCatalog(app.db).find((g) => g.gift_id === input.giftId);
      if (known) {
        giftName ??= known.display_name || known.name;
        coins ??= known.coins;
        imageUrl = known.image_url;
      }
    }
    const event = app.emitTestEvent({ ...input, giftName, coins, imageUrl });
    return { ok: true, event };
  });

  // ルール・スピナーの項目の「テスト」ボタン（要件 U-4）
  server.post('/api/rules/test', async (req, reply) => {
    const input = parse(
      z.object({
        kind: z.enum(['rule', 'spinnerItem']),
        id: z.string().min(1).max(60),
        actionIndex: z.number().int().min(0).max(100).nullable().default(null),
      }),
      req.body,
      reply,
    );
    if (!input) return reply;
    const result = app.testActions(input);
    if ('error' in result) return reply.code(400).send(result);
    return result;
  });

  // セットの切り替え（要件 R-7・U-2）。設定まるごとではなく、ここだけ変える
  server.post('/api/rules/active-set', async (req, reply) => {
    const input = parse(z.object({ id: z.string().min(1).max(60) }), req.body, reply);
    if (!input) return reply;
    const current = app.settings.get();
    if (!current.rules.sets.some((set) => set.id === input.id)) {
      return reply.code(404).send({ error: 'そのセットはありません' });
    }
    const settings = app.settings.replace({ ...current, rules: { ...current.rules, activeSetId: input.id } });
    return { ok: true, activeSetId: settings.rules.activeSetId };
  });

  // スピナー（要件 S-3・U-2）
  server.post('/api/spinner/spin', async (_req, reply) => {
    if (!app.spinner.ready()) {
      return reply.code(400).send({ error: 'スピナーが使えません（「スピナー」画面で、使う設定にして項目を追加してください）' });
    }
    app.spinSpinnerManually();
    return { ok: true };
  });

  // Minecraft（要件 M-2）
  const commandSchema = z.object({ command: z.string().min(1).max(2000), delaySec: z.number().int().min(0).max(60).default(0) });
  server.post('/api/minecraft/command', async (req, reply) => {
    const input = parse(commandSchema, req.body, reply);
    if (!input) return reply;
    if (input.delaySec > 0) {
      setTimeout(() => {
        app.minecraft.execute(input.command).catch(() => {});
      }, input.delaySec * 1000);
      return { ok: true, message: `${input.delaySec}秒後に送ります` };
    }
    try {
      const response = await app.minecraft.execute(input.command);
      return { ok: true, response };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });
  server.post('/api/minecraft/reconnect', async () => {
    app.minecraft.restart();
    return { ok: true };
  });

  // 読み上げ
  server.get('/api/voicevox/speakers', async () => {
    try {
      return { ok: true, speakers: await app.speech.client().speakers() };
    } catch (err) {
      return { ok: false, error: describeError(err), speakers: [] };
    }
  });
  server.post('/api/voicevox/test', async (req, reply) => {
    const input = parse(z.object({ text: z.string().min(1).max(300) }), req.body, reply);
    if (!input) return reply;
    await app.speech.check();
    app.speech.speak(input.text, `テスト：${input.text.slice(0, 20)}`);
    return { ok: true };
  });
  server.get('/api/speech/audio/:file', async (req, reply) => {
    const id = String((req.params as { file: string }).file).replace(/\.wav$/, '');
    const audio = app.speech.getAudio(id);
    if (!audio) return reply.code(404).send({ error: '音声が見つかりません' });
    return reply.type('audio/wav').header('Cache-Control', 'no-store').send(audio);
  });

  // オーバーレイ（要件 O-5）
  server.post('/api/overlays/reload', async () => ({ ok: true, count: app.hub.reloadAll() }));

  // 順番待ち（要件 Q-2）
  server.post('/api/queues/:name/:action', async (req, reply) => {
    const { name, action } = req.params as { name: string; action: string };
    const queue = app.queueByName(name);
    if (!queue) return reply.code(404).send({ error: '順番待ちが見つかりません' });
    if (action === 'pause') queue.pause();
    else if (action === 'resume') queue.resume();
    else if (action === 'skip') queue.skip();
    else if (action === 'clear') queue.clear();
    else return reply.code(400).send({ error: '知らない操作です' });
    return { ok: true, queue: queue.snapshot() };
  });

  // 設定
  server.put('/api/settings', async (req) => ({ ok: true, settings: app.settings.replace(req.body) }));
  server.get('/api/settings/export', async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Disposition', `attachment; filename="settings-${stamp}.json"`)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(app.settings.get(), null, 2));
  });
  server.post('/api/settings/import', async (req) => ({ ok: true, settings: app.settings.replace(req.body) }));

  // 秘密情報（値は返さない。設定済みかどうかだけ）
  const secretsSchema = z.object(Object.fromEntries(SECRET_KEYS.map((k) => [k, z.string().max(500).optional()])));
  server.put('/api/secrets', async (req, reply) => {
    const input = parse(secretsSchema, req.body, reply);
    if (!input) return reply;
    const changed = app.secrets.update(input as Record<string, string | undefined>);
    return { ok: true, changed, secrets: app.secrets.status() };
  });

  // 記録
  server.get('/api/records/streams', async (req) => {
    const q = req.query as { limit?: string; includeTest?: string };
    return { streams: listStreams(app.db, { limit: Number(q.limit) || 50, includeTest: q.includeTest === '1' }) };
  });
  server.get('/api/records/phase0', async () => phase0Check(app.db, app.counters.forDay()));
  server.get('/api/records/info', async () => ({
    db: dbInfo(app.db, app.paths.dbFile),
    backup: app.backups.status(),
    dataDir: app.paths.dataDir,
  }));
  server.post('/api/records/backup', async () => {
    const file = await app.backups.runNow();
    return file ? { ok: true, file } : { ok: false, error: app.backups.status().lastError ?? 'バックアップ中です' };
  });
  server.get('/api/gifts/catalog', async () => ({ gifts: giftCatalog(app.db) }));
  // メディア（要件 A-1）
  server.get('/api/media', async () => ({ files: app.mediaStore.list(), folder: app.mediaStore.folder }));
  server.post('/api/media/upload', { bodyLimit: MAX_MEDIA_BYTES }, async (req, reply) => {
    const name = String((req.query as { name?: string }).name ?? '');
    if (!name) return reply.code(400).send({ error: 'ファイル名がありません' });
    if (!Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ error: 'ファイルの中身が送られてきませんでした' });
    }
    try {
      const file = app.mediaStore.save(name, req.body);
      return { ok: true, file, files: app.mediaStore.list() };
    } catch (err) {
      return reply.code(400).send({ error: describeError(err) });
    }
  });
  server.post('/api/media/delete', async (req, reply) => {
    const input = parse(z.object({ name: z.string().min(1).max(200) }), req.body, reply);
    if (!input) return reply;
    if (!app.mediaStore.remove(input.name)) {
      return reply.code(404).send({ error: 'そのファイルはありません' });
    }
    return { ok: true, files: app.mediaStore.list() };
  });
  server.get('/api/media/kinds', async () => ({ extensions: ALLOWED_EXTENSIONS, maxBytes: MAX_MEDIA_BYTES }));

  // ギフトに自分で付ける表示名（要件 R-4）。空にすると、TikTokの名前に戻る
  server.put('/api/gifts/display-name', async (req, reply) => {
    const input = parse(z.object({ giftId: z.string().min(1).max(60), displayName: z.string().max(60) }), req.body, reply);
    if (!input) return reply;
    const ok = setGiftDisplayName(app.db, input.giftId, input.displayName);
    if (!ok) return reply.code(404).send({ error: 'そのギフトはまだ一覧にありません（1回でも届くと出てきます）' });
    return { ok: true, gifts: giftCatalog(app.db) };
  });

  // フォルダを開く（Windowsのエクスプローラー）
  server.post('/api/app/open-folder', async (req, reply) => {
    const input = parse(z.object({ which: z.enum(['data', 'backup', 'logs']) }), req.body, reply);
    if (!input) return reply;
    const folder =
      input.which === 'data' ? app.paths.dataDir : input.which === 'logs' ? app.paths.logDir : app.backups.folder();
    if (process.platform === 'win32') {
      spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, folder };
    }
    return { ok: false, folder, error: 'Windowsでだけ使えます' };
  });

  // 終了
  server.post('/api/app/quit', async () => {
    setTimeout(() => app.requestQuit(), 200);
    return { ok: true };
  });

  server.setErrorHandler((err, _req, reply) => {
    app.logger.area('Web').error('リクエストの処理中にエラー', err);
    void reply.code(500).send({ error: describeError(err) });
  });

  return server;
}

/** 入力を検査する。おかしければ 400 を返して null */
function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    void reply.code(400).send({ error: '入力の形が正しくありません', detail: result.error.issues.map((i) => i.message) });
    return null;
  }
  return result.data;
}


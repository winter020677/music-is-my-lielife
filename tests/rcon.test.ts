// RCON（Minecraft）とMinecraftの接続管理のテスト（にせのMinecraftサーバーを使う）
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MinecraftService } from '../src/server/actions/minecraft/service.ts';
import { RconAuthError, RconClient, decodePackets, encodePacket } from '../src/server/actions/minecraft/rcon.ts';
import { defaultSettings } from '../src/server/config/settings.ts';
import { log } from './helpers.ts';

interface FakeServer {
  server: Server;
  port: number;
  commands: string[];
  sockets: Socket[];
}

async function fakeMinecraft(password = 'secret', respond: (cmd: string) => string = (c) => `ok:${c}`): Promise<FakeServer> {
  const commands: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { packets, rest } = decodePackets(buffer);
      buffer = rest;
      for (const p of packets) {
        if (p.type === 3) socket.write(encodePacket(p.body === password ? p.id : -1, 2, ''));
        else {
          commands.push(p.body);
          // わざと2回に分けて送る（TCPで分かれて届くことがあるため）
          const reply = encodePacket(p.id, 0, respond(p.body));
          socket.write(reply.subarray(0, 5));
          setTimeout(() => socket.write(reply.subarray(5)), 5);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port, commands, sockets };
}

const servers: FakeServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    for (const sock of s.sockets) sock.destroy();
    await new Promise((r) => s.server.close(r));
  }
});

describe('RCON', () => {
  it('ログインして、コマンドの返事を受け取る（日本語も）', async () => {
    const fake = await fakeMinecraft();
    servers.push(fake);
    const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'secret' });
    await client.connect();
    expect(await client.send('/say こんにちは')).toBe('ok:say こんにちは');
    expect(fake.commands).toEqual(['say こんにちは']);
    client.close();
  });

  it('パスワードが違うと RconAuthError', async () => {
    const fake = await fakeMinecraft();
    servers.push(fake);
    const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'wrong' });
    await expect(client.connect()).rejects.toBeInstanceOf(RconAuthError);
  });

  it('サーバーが動いていないと、つながらないエラー', async () => {
    const client = new RconClient({ host: '127.0.0.1', port: 1, password: 'x', timeoutMs: 1000 });
    await expect(client.connect()).rejects.toThrow();
  });

  it('長すぎるコマンドは送らない', async () => {
    const fake = await fakeMinecraft();
    servers.push(fake);
    const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'secret' });
    await client.connect();
    await expect(client.send('say ' + 'a'.repeat(2000))).rejects.toThrow(/長すぎます/);
    client.close();
  });
});

describe('Minecraftの接続管理', () => {
  function service(port: number, password = 'secret') {
    const settings = defaultSettings();
    settings.minecraft.enabled = true;
    settings.minecraft.port = port;
    settings.minecraft.maxCommandsPerSecond = 20;
    return new MinecraftService({ getSettings: () => settings.minecraft, getPassword: () => password, log });
  }

  async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('時間切れ');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('つないで、順番待ちのコマンドを上限の速さで送る（要件 Q-3）', async () => {
    const fake = await fakeMinecraft();
    servers.push(fake);
    const mc = service(fake.port);
    mc.restart();
    await waitFor(() => mc.getStatus().state === 'connected');
    const started = Date.now();
    let done: unknown = 'pending';
    mc.enqueue(['say 1', 'say 2', 'say 3', 'say 4', 'say 5'], 'テスト', (err) => (done = err));
    await waitFor(() => done !== 'pending');
    expect(done).toBeNull();
    expect(fake.commands).toEqual(['say 1', 'say 2', 'say 3', 'say 4', 'say 5']);
    // 1秒に20回まで → 5つ送るには 4 × 50ms 以上かかる
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    mc.stop();
  });

  it('パスワードが未設定なら、つながずに「未設定」', () => {
    const mc = service(1, '');
    mc.restart();
    expect(mc.getStatus().state).toBe('no-password');
  });

  it('切れたら自動でつなぎ直す（要件 M-1）', async () => {
    const fake = await fakeMinecraft();
    servers.push(fake);
    const mc = service(fake.port);
    mc.restart();
    await waitFor(() => mc.getStatus().state === 'connected');
    for (const s of fake.sockets) s.destroy();
    await waitFor(() => mc.getStatus().state === 'error');
    await waitFor(() => mc.getStatus().state === 'connected', 8000);
    mc.stop();
  });

  it('つながっていない時のコマンドは、分かりやすいエラーになる', async () => {
    const mc = service(1);
    await expect(mc.execute('say x')).rejects.toThrow(/サーバーが起動しているか/);
    expect(mc.recentResults()[0]).toMatchObject({ command: 'say x', ok: false });
  });
});

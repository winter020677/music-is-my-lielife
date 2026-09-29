// 読み上げ（VOICEVOX）のテスト（にせのVOICEVOXを使う）
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayHub, type OverlaySocket } from '../src/server/actions/overlayHub.ts';
import { SpeechService, VoicevoxClient, wavDurationMs } from '../src/server/actions/voicevox.ts';
import { defaultSettings } from '../src/server/config/settings.ts';
import { log } from './helpers.ts';

function makeWav(ms: number, rate = 24000): Buffer {
  const samples = Math.round((rate * ms) / 1000);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function fakeVoicevox() {
  const queries: Array<{ text: string | null; speaker: string | null }> = [];
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/version') {
      res.end('"0.99.0"');
      return;
    }
    if (url.pathname === '/audio_query') {
      queries.push({ text: url.searchParams.get('text'), speaker: url.searchParams.get('speaker') });
      res.end('{"speedScale":1,"volumeScale":1}');
      return;
    }
    if (url.pathname === '/synthesis') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        bodies.push(JSON.parse(body));
        res.setHeader('content-type', 'audio/wav');
        res.end(makeWav(300));
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, queries, bodies };
}

/** オーバーレイのにせもの：届いた知らせを記録し、speech なら「再生が終わった」を返す */
function fakeOverlay(hub: OverlayHub, name: string) {
  const received: Array<Record<string, unknown>> = [];
  let onMessage: (data: unknown) => void = () => {};
  const socket: OverlaySocket = {
    readyState: 1,
    send(data: string) {
      const message = JSON.parse(data);
      received.push(message);
      if (message.type === 'speech') setTimeout(() => onMessage(JSON.stringify({ type: 'ended', id: message.id })), 10);
    },
    close() {},
    on(event: string, listener: (data?: unknown) => void) {
      if (event === 'message') onMessage = listener as (data: unknown) => void;
    },
  } as OverlaySocket;
  hub.add(name, socket);
  return received;
}

describe('VOICEVOX', () => {
  it('WAVの長さを読む', () => {
    expect(wavDurationMs(makeWav(1500))).toBe(1500);
    expect(wavDurationMs(Buffer.from('not a wav'))).toBeNull();
  });

  it('文から音声を作る（話者・速さ・音量を渡す）', async () => {
    const fake = await fakeVoicevox();
    const client = new VoicevoxClient(fake.url);
    expect(await client.version()).toBe('0.99.0');
    const wav = await client.synthesize('こんにちは', { speakerId: 3, speed: 1.2, volume: 0.8, pitch: 0 });
    expect(wavDurationMs(wav)).toBe(300);
    expect(fake.queries).toEqual([{ text: 'こんにちは', speaker: '3' }]);
    expect(fake.bodies[0]).toMatchObject({ speedScale: 1.2, volumeScale: 0.8 });
  });

  it('VOICEVOXが起動していないと、分かりやすいエラー', async () => {
    const client = new VoicevoxClient('http://127.0.0.1:1', 1000);
    await expect(client.version()).rejects.toThrow(/VOICEVOXにつながりません/);
  });

  it('読み上げ用オーバーレイに音声を送り、再生が終わるまで待つ', async () => {
    const fake = await fakeVoicevox();
    const settings = defaultSettings();
    settings.voicevox.enabled = true;
    settings.voicevox.url = fake.url;
    const hub = new OverlayHub(() => ({}));
    const received = fakeOverlay(hub, 'speech');
    const speech = new SpeechService({ getSettings: () => settings.voicevox, hub, log });
    let result: unknown = 'pending';
    speech.speak('たろうさん、バラありがとう', 'テスト', (err) => (result = err));
    const start = Date.now();
    while (result === 'pending' && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
    expect(result).toBeNull();
    const message = received.find((m) => m.type === 'speech');
    expect(message).toMatchObject({ type: 'speech', text: 'たろうさん、バラありがとう' });
    expect(speech.getAudio(String(message?.id))).not.toBeNull();
  });

  it('読み上げ用オーバーレイがOBSにない時は、エラーとして知らせる', async () => {
    const settings = defaultSettings();
    settings.voicevox.enabled = true;
    const hub = new OverlayHub(() => ({}));
    const speech = new SpeechService({ getSettings: () => settings.voicevox, hub, log });
    let result: unknown = 'pending';
    speech.speak('テスト', 'テスト', (err) => (result = err));
    while (result === 'pending') await new Promise((r) => setTimeout(r, 5));
    expect(String(result)).toMatch(/オーバーレイ/);
  });
});

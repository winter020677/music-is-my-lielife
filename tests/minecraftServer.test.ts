// Minecraftサーバーの起動・停止とコンソールのテスト（要件 M-3）
// 本物の java の代わりに、Paperのふりをする小さなNode.jsのスクリプトを動かす。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MinecraftServerProcess, planPaperLaunch, type LaunchPlan } from '../src/server/actions/minecraft/serverProcess.ts';
import { defaultSettings, type Settings } from '../src/server/config/settings.ts';
import { log } from './helpers.ts';

// Paperのふり：起動したら「Done」を出し、入力をそのまま返し、stop で保存して終わる。
// ignore-stop を受け取ると、stop を無視する（固まったサーバーのふり）
const FAKE_PAPER = `
const readline = require('node:readline');
console.log('\\x1b[32m[12:00:00 INFO]: Starting minecraft server\\x1b[0m');
setTimeout(() => console.log('[12:00:01 INFO]: Done (1.234s)! For help, type "help"'), 50);
let ignoreStop = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'ignore-stop') { ignoreStop = true; return; }
  if (line === 'stop' && !ignoreStop) {
    console.log('[12:00:02 INFO]: Saving worlds');
    setTimeout(() => process.exit(0), 50);
    return;
  }
  console.log('echo:' + line);
});
setInterval(() => {}, 1000);
`;

const CRASHING = `console.error('Failed to load eula.txt'); process.exit(1);`;

function script(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlt-mc-'));
  const file = join(dir, 'fake.cjs');
  writeFileSync(file, body);
  return file;
}

function settings(extra: Partial<Settings['minecraft']> = {}): Settings['minecraft'] {
  return { ...defaultSettings().minecraft, serverFolder: tmpdir(), ...extra };
}

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error('待ちきれませんでした'));
      else setTimeout(tick, 10);
    };
    tick();
  });
}

let running: MinecraftServerProcess[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.kill()));
  running = [];
});

function create(body: string, options: { connected?: boolean; onReady?: () => void } = {}) {
  const file = script(body);
  const plan = (): LaunchPlan => ({ command: process.execPath, args: [file], cwd: tmpdir() });
  const server = new MinecraftServerProcess({
    getSettings: () => settings(),
    log,
    plan,
    isConnectedElsewhere: () => options.connected ?? false,
    onReady: options.onReady,
  });
  running.push(server);
  return server;
}

describe('Minecraftサーバーの起動と停止', () => {
  it('起動して「Done」が出たら動いている状態になり、RCONのつなぎ直しを呼ぶ', async () => {
    let ready = 0;
    const server = create(FAKE_PAPER, { onReady: () => (ready += 1) });
    server.start();
    expect(server.getStatus().state).toBe('starting');
    await waitFor(() => server.getStatus().state === 'running');
    expect(ready).toBe(1);
    // 色の記号（ANSI）は取りのぞく
    const texts = server.consoleLines().map((l) => l.text);
    expect(texts).toContain('[12:00:00 INFO]: Starting minecraft server');
  });

  it('コンソールにコマンドを送れる（改行は1行にまとめる）', async () => {
    const server = create(FAKE_PAPER);
    server.start();
    await waitFor(() => server.getStatus().state === 'running');
    server.send('say hello\nworld');
    await waitFor(() => server.consoleLines().some((l) => l.text === 'echo:say hello world'));
    expect(server.consoleLines().some((l) => l.kind === 'in' && l.text === 'say hello world')).toBe(true);
  });

  it('停止は stop を送って、止まり終わるまで待つ', async () => {
    const server = create(FAKE_PAPER);
    server.start();
    await waitFor(() => server.getStatus().state === 'running');
    await server.stop();
    expect(server.isRunning()).toBe(false);
    expect(server.getStatus()).toMatchObject({ state: 'stopped', hint: null });
    expect(server.consoleLines().some((l) => l.text.includes('Saving worlds'))).toBe(true);
  });

  it('stop で止まらない時は、時間切れで強制終了する', async () => {
    const server = create(FAKE_PAPER);
    server.start();
    await waitFor(() => server.getStatus().state === 'running');
    server.send('ignore-stop');
    await server.stop(200);
    expect(server.isRunning()).toBe(false);
    expect(server.consoleLines().some((l) => l.text.includes('強制終了します'))).toBe(true);
  });

  it('起動してすぐ止まったら、理由の手がかりを出す', async () => {
    const server = create(CRASHING);
    server.start();
    await waitFor(() => !server.isRunning());
    const status = server.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.message).toContain('起動してすぐに止まりました');
    expect(status.hint).toContain('eula');
    expect(server.consoleLines().some((l) => l.kind === 'err' && l.text === 'Failed to load eula.txt')).toBe(true);
  });

  it('Javaが見つからない時は、分かる言葉で知らせる', async () => {
    const server = new MinecraftServerProcess({
      getSettings: () => settings(),
      log,
      plan: () => ({ command: 'no-such-java-xyz', args: [], cwd: tmpdir() }),
    });
    running.push(server);
    server.start();
    await waitFor(() => !server.isRunning());
    expect(server.getStatus().message).toContain('Javaが見つかりません');
  });

  it('二重には起動しない。本体の外で動いているサーバーも起動しない', async () => {
    const server = create(FAKE_PAPER);
    server.start();
    expect(() => server.start()).toThrow('もう動いています');
    const other = create(FAKE_PAPER, { connected: true });
    expect(() => other.start()).toThrow('すでに起動しているようです');
  });

  it('動いていない時にコマンドを送るとエラー', () => {
    const server = create(FAKE_PAPER);
    expect(() => server.send('list')).toThrow('サーバーが動いていません');
  });
});

describe('起動のしかた（planPaperLaunch）', () => {
  function folderWith(...files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'tlt-mcdir-'));
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), '');
    return dir;
  }

  it('フォルダが未設定・見つからない時はエラー', () => {
    expect(() => planPaperLaunch(settings({ serverFolder: '' }))).toThrow('未設定');
    expect(() => planPaperLaunch(settings({ serverFolder: join(tmpdir(), 'no-such-folder-xyz') }))).toThrow('見つかりません');
  });

  it('jar が1つならそれを使う。メモリとUTF-8の指定を付ける', () => {
    const dir = folderWith('server.jar', 'eula.txt');
    const plan = planPaperLaunch(settings({ serverFolder: dir, memoryGb: 6 }));
    expect(plan).toEqual({
      command: 'java',
      args: ['-Xms6G', '-Xmx6G', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-jar', 'server.jar', 'nogui'],
      cwd: dir,
    });
  });

  it('jar が複数なら paper で始まるものを選ぶ。決められなければエラー', () => {
    expect(planPaperLaunch(settings({ serverFolder: folderWith('paper-1.21.4-100.jar', 'other.jar') })).args).toContain('paper-1.21.4-100.jar');
    expect(() => planPaperLaunch(settings({ serverFolder: folderWith('a.jar', 'b.jar') }))).toThrow('複数');
    expect(() => planPaperLaunch(settings({ serverFolder: folderWith() }))).toThrow('jar ファイルがありません');
  });

  it('jar の名前とJavaの場所を指定できる（フォルダの外は指せない）', () => {
    const dir = folderWith('a.jar', 'b.jar');
    const plan = planPaperLaunch(settings({ serverFolder: dir, jarFile: '..\\..\\b.jar', javaPath: 'C:\\Java\\bin\\java.exe' }));
    expect(plan.command).toBe('C:\\Java\\bin\\java.exe');
    expect(plan.args).toContain('b.jar');
    expect(() => planPaperLaunch(settings({ serverFolder: dir, jarFile: 'c.jar' }))).toThrow('ありません');
  });
});

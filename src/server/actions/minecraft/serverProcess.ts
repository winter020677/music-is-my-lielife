// Minecraftサーバーの起動・停止とコンソール（要件 M-3。STEの起動ボタンの代わり）
//
// ・設定の「サーバーのフォルダ」にある Paper の jar を、本体が java で起動する
//   （黒い画面は出さない。サーバーの出力は管理画面のコンソールに流す）
// ・コンソールの入力欄から、サーバーにコマンドを送れる（RCONではなく、サーバーの標準入力に書く）
// ・停止は、まず stop コマンドを送ってワールドを保存させる。時間内に止まらない時だけ強制終了する
// ・起動が終わった（「Done (…)!」が出た）ら、RCONをすぐにつなぎ直す
// ・本体を終了すると、サーバーも止める（Windowsでは本体が終わると子のサーバーも道連れで止まるので、
//   先に stop で保存させておく）

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Settings } from '../../config/settings.ts';
import { describeError, type AreaLogger } from '../../core/logger.ts';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface ServerStatus {
  state: ServerState;
  message: string;
  hint: string | null;
  startedAt: string | null;
  /** サーバーのフォルダが設定されているか */
  configured: boolean;
}

export interface ConsoleLine {
  id: number;
  at: string;
  /** out＝サーバーの出力、err＝サーバーのエラー出力、in＝送ったコマンド、info＝本体からのお知らせ */
  kind: 'out' | 'err' | 'in' | 'info';
  text: string;
}

/** 起動のしかた（何を、どのフォルダで動かすか） */
export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
}

type ServerSettings = Settings['minecraft'];

const CONSOLE_LIMIT = 1000;
const STOP_TIMEOUT_MS = 60_000;
/** 起動してからこの時間より早く止まったら「起動に失敗した」とみなす */
const EARLY_EXIT_MS = 20_000;
/** Paperの起動が終わった時の行（例：Done (12.345s)! For help, type "help"） */
const READY_PATTERN = /Done \([\d.,]+s\)!/;
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export class LaunchError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

/**
 * 設定から、Paperサーバーの起動のしかたを決める。
 * jarファイルの名前が空なら、フォルダの中の .jar を探す（1つだけならそれ、複数なら paper で始まるもの）。
 */
export function planPaperLaunch(settings: ServerSettings): LaunchPlan {
  const folder = settings.serverFolder.trim();
  if (!folder) {
    throw new LaunchError('サーバーのフォルダが未設定です', '「設定」→「Minecraft」の「サーバーのフォルダ」に、paper の jar があるフォルダを入力してください');
  }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new LaunchError(`サーバーのフォルダが見つかりません（${folder}）`, '「設定」→「Minecraft」の「サーバーのフォルダ」が正しいか確認してください');
  }
  // 名前だけを使う（フォルダの外のファイルを指せないように、区切り文字より前は捨てる）
  let jar = settings.jarFile.trim().split(/[\\/]/).pop() ?? '';
  if (jar) {
    if (!existsSync(join(folder, jar))) {
      throw new LaunchError(`${jar} がサーバーのフォルダにありません`, '「設定」→「Minecraft」の「jarファイルの名前」を確認してください（空にすると自動で探します）');
    }
  } else {
    const jars = readdirSync(folder).filter((name) => name.toLowerCase().endsWith('.jar'));
    const papers = jars.filter((name) => name.toLowerCase().startsWith('paper'));
    if (jars.length === 1) jar = jars[0];
    else if (papers.length === 1) jar = papers[0];
    else if (jars.length === 0) {
      throw new LaunchError('サーバーのフォルダに jar ファイルがありません', 'Paper の jar（例：paper-1.21.4-100.jar）を置いたフォルダを指定してください');
    } else {
      throw new LaunchError(
        `jar ファイルが複数あって、どれを使うか決められません（${jars.join('、')}）`,
        '「設定」→「Minecraft」の「jarファイルの名前」に、使うものの名前を入力してください',
      );
    }
  }
  const memory = `${settings.memoryGb}G`;
  return {
    command: settings.javaPath.trim() || 'java',
    args: [
      `-Xms${memory}`,
      `-Xmx${memory}`,
      // 日本語が文字化けしないように、出力をUTF-8にする（Java 19以降で効く）
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      '-jar',
      jar,
      'nogui',
    ],
    cwd: folder,
  };
}

/** server.properties と同じフォルダの eula.txt で、EULA（利用規約）に同意済みか */
function eulaAccepted(folder: string): boolean {
  try {
    return /^\s*eula\s*=\s*true\s*$/m.test(readFileSync(join(folder, 'eula.txt'), 'utf8'));
  } catch {
    return false;
  }
}

export class MinecraftServerProcess {
  private readonly getSettings: () => ServerSettings;
  private readonly log: AreaLogger;
  private readonly plan: (settings: ServerSettings) => LaunchPlan;
  private readonly isConnectedElsewhere: () => boolean;
  private readonly onReady: () => void;
  private child: ChildProcess | null = null;
  private status: ServerStatus;
  private stopRequested = false;
  private exitWaiters: Array<() => void> = [];
  private readonly lines: ConsoleLine[] = [];
  private lineSerial = 0;
  private readonly listeners = new Set<() => void>();
  private readonly lineListeners = new Set<(line: ConsoleLine) => void>();

  constructor(options: {
    getSettings: () => ServerSettings;
    log: AreaLogger;
    /** RCONでつながっているか（本体の外で起動したサーバーを、二重に起動しないため） */
    isConnectedElsewhere?: () => boolean;
    /** 起動が終わった時に呼ぶ（RCONのつなぎ直し） */
    onReady?: () => void;
    /** テスト用：起動のしかたを差し替える */
    plan?: (settings: ServerSettings) => LaunchPlan;
  }) {
    this.getSettings = options.getSettings;
    this.log = options.log;
    this.plan = options.plan ?? planPaperLaunch;
    this.isConnectedElsewhere = options.isConnectedElsewhere ?? (() => false);
    this.onReady = options.onReady ?? (() => {});
    this.status = this.stoppedStatus('止まっています', null);
  }

  getStatus(): ServerStatus {
    // 設定が変わっても、止まっている時の表示がすぐ変わるように、毎回作り直す
    if (this.status.state === 'stopped') return { ...this.status, configured: this.getSettings().serverFolder.trim() !== '' };
    return this.status;
  }

  /** 動いているか（起動中・停止中も含む） */
  isRunning(): boolean {
    return this.child !== null;
  }

  consoleLines(): ConsoleLine[] {
    return [...this.lines];
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onLine(listener: (line: ConsoleLine) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  /** サーバーを起動する。起動できない理由があれば、分かりやすい文で投げる */
  start(): void {
    if (this.child) throw new Error('サーバーはもう動いています');
    if (this.isConnectedElsewhere()) {
      throw new Error('サーバーはすでに起動しているようです（Minecraftにつながっています）。本体の外で起動したサーバーは、ここからは止められません');
    }
    let plan: LaunchPlan;
    try {
      plan = this.plan(this.getSettings());
    } catch (err) {
      if (err instanceof LaunchError) {
        this.setStatus(this.stoppedStatus(err.message, err.hint));
        throw new Error(`${err.message}。${err.hint}`);
      }
      throw err;
    }

    this.addLine('info', `サーバーを起動します：${plan.command} ${plan.args.join(' ')}（フォルダ：${plan.cwd}）`);
    this.log.info(`Minecraftサーバーを起動します（${plan.cwd}）`);
    const startedAt = Date.now();
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.stopRequested = false;
    this.setStatus({
      state: 'starting',
      message: '起動しています…',
      hint: null,
      startedAt: new Date(startedAt).toISOString(),
      configured: true,
    });

    this.readLines(child.stdout, 'out');
    this.readLines(child.stderr, 'err');
    // 入力の書き込みに失敗しても（止まる途中など）、本体は落とさない
    child.stdin?.on('error', () => {});

    let launchFailed = false;
    child.on('error', (err) => {
      launchFailed = true;
      const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      const message = notFound ? `Javaが見つかりません（${plan.command}）` : `サーバーを起動できませんでした（${describeError(err)}）`;
      const hint = notFound
        ? 'Java（Paperの版に合うもの。1.21なら Java 21）を入れるか、「設定」→「Minecraft」の「Javaの場所」に java.exe の場所を入力してください'
        : 'コンソールの最後のほうに理由が出ていないか確認してください';
      this.addLine('info', message);
      this.log.error(message);
      this.finish(this.stoppedStatus(message, hint));
    });
    child.on('exit', (code, signal) => {
      if (launchFailed) return;
      const how = signal ? `合図 ${signal}` : `終了コード ${code}`;
      if (this.stopRequested) {
        this.addLine('info', `サーバーが止まりました（${how}）`);
        this.log.info('Minecraftサーバーが止まりました');
        this.finish(this.stoppedStatus('止まっています', null));
        return;
      }
      const early = Date.now() - startedAt < EARLY_EXIT_MS;
      const hint =
        early && !eulaAccepted(plan.cwd)
          ? 'Minecraftの利用規約（EULA）に同意していないようです。サーバーのフォルダの eula.txt を開き、eula=false を eula=true に書き換えてから、もう一度起動してください'
          : 'コンソールの最後のほうに、止まった理由が出ています';
      const message = early ? `サーバーが起動してすぐに止まりました（${how}）` : `サーバーが止まりました（${how}）`;
      this.addLine('info', message);
      this.log.warn(message);
      this.finish(this.stoppedStatus(message, hint));
    });
  }

  /**
   * サーバーを止める。stop コマンドでワールドを保存させ、時間内に止まらなければ強制終了する。
   * 止まり終わるまで待つ。
   */
  async stop(timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = this.waitForExit();
    if (!this.stopRequested) {
      this.stopRequested = true;
      this.setStatus({ ...this.status, state: 'stopping', message: '止めています（ワールドを保存しています）…', hint: null });
      this.addLine('in', 'stop');
      child.stdin?.write('stop\n');
    }
    const timer = setTimeout(() => {
      if (this.child !== child) return;
      this.addLine('info', `${Math.round(timeoutMs / 1000)}秒たっても止まらないので、強制終了します`);
      this.log.warn('Minecraftサーバーが止まらないので、強制終了しました');
      child.kill();
    }, timeoutMs);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 保存を待たずに、すぐ止める（固まった時用。ワールドの保存されていない分は失われる） */
  async kill(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = this.waitForExit();
    this.stopRequested = true;
    this.addLine('info', '強制終了します');
    child.kill();
    await exited;
  }

  /** コンソールにコマンドを1行送る */
  send(input: string): void {
    const line = input.replace(/[\r\n]+/g, ' ').trim();
    if (!line) return;
    if (!this.child?.stdin?.writable) throw new Error('サーバーが動いていません');
    this.addLine('in', line);
    this.child.stdin.write(`${line}\n`);
  }

  private waitForExit(): Promise<void> {
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }

  private finish(status: ServerStatus): void {
    this.child = null;
    this.setStatus(status);
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private readLines(stream: NodeJS.ReadableStream | null, kind: 'out' | 'err'): void {
    if (!stream) return;
    const decoder = new StringDecoder('utf8');
    let rest = '';
    const handle = (text: string) => {
      const parts = (rest + text).split(/\r?\n/);
      rest = parts.pop() ?? '';
      for (const part of parts) this.handleOutput(kind, part);
    };
    stream.on('data', (chunk: Buffer) => handle(decoder.write(chunk)));
    stream.on('end', () => {
      handle(decoder.end());
      if (rest) this.handleOutput(kind, rest);
      rest = '';
    });
  }

  private handleOutput(kind: 'out' | 'err', raw: string): void {
    const text = raw.replace(ANSI_PATTERN, '').replace(/\r/g, '');
    if (!text.trim()) return;
    this.addLine(kind, text);
    if (this.status.state === 'starting' && READY_PATTERN.test(text)) {
      this.log.info('Minecraftサーバーの起動が終わりました');
      this.setStatus({ ...this.status, state: 'running', message: '動いています', hint: null });
      this.onReady();
    }
  }

  private addLine(kind: ConsoleLine['kind'], text: string): void {
    this.lineSerial += 1;
    const line: ConsoleLine = { id: this.lineSerial, at: new Date().toISOString(), kind, text: text.slice(0, 2000) };
    this.lines.push(line);
    if (this.lines.length > CONSOLE_LIMIT) this.lines.shift();
    for (const listener of this.lineListeners) listener(line);
  }

  private stoppedStatus(message: string, hint: string | null): ServerStatus {
    return { state: 'stopped', message, hint, startedAt: null, configured: this.getSettings().serverFolder.trim() !== '' };
  }

  private setStatus(status: ServerStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener();
  }
}

// RCON（Minecraftのサーバーに、外からコマンドを送る仕組み）の通信部分
//
// Minecraftのサーバーの server.properties で、次を設定しておく必要がある：
//   enable-rcon=true
//   rcon.password=（パスワード）
//   rcon.port=25575
//
// 通信の形（1つの「パケット」）：
//   [長さ 4バイト][リクエストID 4バイト][種類 4バイト][本文][0][0]
//   種類：3＝ログイン 2＝コマンド 0＝返事

import { Socket } from 'node:net';

const TYPE_AUTH = 3;
const TYPE_COMMAND = 2;
/** Minecraftが受け付けるコマンドの最大の長さ（バイト） */
export const MAX_COMMAND_BYTES = 1446;
/** 返事が長い時は、このくらいの大きさで分けて届く */
const FRAGMENT_SIZE = 4096;

export class RconAuthError extends Error {}

interface Pending {
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  chunks: string[];
  fragmentTimer: NodeJS.Timeout | null;
}

export function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBytes = Buffer.from(body, 'utf8');
  const packet = Buffer.alloc(4 + 4 + 4 + bodyBytes.length + 2);
  packet.writeInt32LE(4 + 4 + bodyBytes.length + 2, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBytes.copy(packet, 12);
  return packet;
}

/** 受け取ったデータから、完全なパケットを取り出す（残りは rest） */
export function decodePackets(buffer: Buffer): { packets: Array<{ id: number; type: number; body: string }>; rest: Buffer } {
  const packets: Array<{ id: number; type: number; body: string }> = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readInt32LE(offset);
    if (length < 10 || length > 1024 * 1024) throw new Error(`RCONのデータが壊れています（長さ ${length}）`);
    if (buffer.length - offset < 4 + length) break;
    const id = buffer.readInt32LE(offset + 4);
    const type = buffer.readInt32LE(offset + 8);
    const body = buffer.toString('utf8', offset + 12, offset + 4 + length - 2);
    packets.push({ id, type, body });
    offset += 4 + length;
  }
  return { packets, rest: buffer.subarray(offset) };
}

export class RconClient {
  private readonly host: string;
  private readonly port: number;
  private readonly password: string;
  private readonly timeoutMs: number;
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private authenticated = false;
  private closeListener: ((reason: string) => void) | null = null;

  constructor(options: { host: string; port: number; password: string; timeoutMs?: number }) {
    this.host = options.host;
    this.port = options.port;
    this.password = options.password;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  get connected(): boolean {
    return this.authenticated && this.socket !== null && !this.socket.destroyed;
  }

  /** 切れた時に呼ばれる */
  onClose(listener: (reason: string) => void): void {
    this.closeListener = listener;
  }

  /** つないでログインする */
  async connect(): Promise<void> {
    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onSocketClosed('接続が閉じられました'));
    socket.on('error', (err) => this.onSocketClosed(err.message));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Minecraftのサーバーから応答がありません'));
      }, this.timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.connect(this.port, this.host);
    });

    const id = this.allocateId();
    const reply = this.request(id, TYPE_AUTH, this.password);
    try {
      await reply;
    } catch (err) {
      this.close();
      throw err;
    }
    this.authenticated = true;
  }

  /** コマンドを送って、返事の文字を受け取る */
  async send(command: string): Promise<string> {
    if (!this.connected) throw new Error('Minecraftにつながっていません');
    const clean = command.replace(/^\//, '').replace(/[\r\n]/g, ' ').trim();
    if (!clean) throw new Error('コマンドが空です');
    if (Buffer.byteLength(clean, 'utf8') > MAX_COMMAND_BYTES) {
      throw new Error(`コマンドが長すぎます（${MAX_COMMAND_BYTES}バイトまで）`);
    }
    return this.request(this.allocateId(), TYPE_COMMAND, clean);
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    socket?.destroy();
    this.failAll(new Error('Minecraftとの接続を閉じました'));
  }

  private request(id: number, type: number, body: string): Promise<string> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('Minecraftにつながっていません'));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Minecraftから返事がありません（時間切れ）'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, chunks: [], fragmentTimer: null });
      socket.write(encodePacket(id, type, body));
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let decoded;
    try {
      decoded = decodePackets(this.buffer);
    } catch (err) {
      this.onSocketClosed((err as Error).message);
      return;
    }
    this.buffer = decoded.rest;
    for (const packet of decoded.packets) this.onPacket(packet);
  }

  private onPacket(packet: { id: number; type: number; body: string }): void {
    // ログイン失敗の時は、リクエストIDが -1 で返ってくる
    if (packet.id === -1) {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new RconAuthError('RCONのパスワードが違います'));
      }
      return;
    }
    const pending = this.pending.get(packet.id);
    if (!pending) return;
    pending.chunks.push(packet.body);
    if (pending.fragmentTimer) clearTimeout(pending.fragmentTimer);
    const finish = () => {
      clearTimeout(pending.timer);
      this.pending.delete(packet.id);
      pending.resolve(pending.chunks.join(''));
    };
    // 返事が長いと分けて届くので、少しだけ続きを待つ
    if (Buffer.byteLength(packet.body, 'utf8') >= FRAGMENT_SIZE - 100) {
      pending.fragmentTimer = setTimeout(finish, 150);
    } else {
      finish();
    }
  }

  private onSocketClosed(reason: string): void {
    if (!this.socket) return;
    this.socket.destroy();
    this.socket = null;
    const wasAuthenticated = this.authenticated;
    this.authenticated = false;
    this.failAll(new Error(`Minecraftとの接続が切れました（${reason}）`));
    if (wasAuthenticated) this.closeListener?.(reason);
  }

  private failAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      if (pending.fragmentTimer) clearTimeout(pending.fragmentTimer);
      this.pending.delete(id);
      pending.reject(err);
    }
  }

  private allocateId(): number {
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
    return this.nextId;
  }
}

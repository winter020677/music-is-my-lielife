// 読み上げ（VOICEVOX）（要件 A-4）
//
// VOICEVOXのアプリ（またはエンジン）を起動しておくと、PCの中で音声を作ってくれる（通常 http://127.0.0.1:50021）。
// ・本体がVOICEVOXに文を渡して音声（WAV）を作ってもらう
// ・音声は「読み上げ用オーバーレイ」（OBSのブラウザソース）で鳴らすので、配信の音に乗る（要件 O-2）
// ・読み上げは1つずつ順番に（前の音声が終わってから次へ）
// ・VOICEVOXはキャラクターごとの利用規約に従う。配信の概要欄などにクレジット（例：「VOICEVOX:ずんだもん」）を書く（要件 N-8）

import { randomUUID } from 'node:crypto';
import type { OverlayHub } from './overlayHub.ts';
import { describeError, type AreaLogger } from '../core/logger.ts';
import { ActionQueue } from '../core/queue.ts';
import { forSpeech } from '../core/sanitize.ts';
import type { Settings } from '../config/settings.ts';

export interface VoicevoxSpeaker {
  name: string;
  styles: Array<{ name: string; id: number }>;
}

export interface SynthesisOptions {
  speakerId: number;
  speed: number;
  volume: number;
  pitch: number;
}

export class VoicevoxClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 15_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async version(): Promise<string> {
    const res = await this.fetch('/version');
    return String(await res.json());
  }

  async speakers(): Promise<VoicevoxSpeaker[]> {
    const res = await this.fetch('/speakers');
    const list = (await res.json()) as Array<{ name: string; styles: Array<{ name: string; id: number }> }>;
    return list.map((s) => ({ name: s.name, styles: s.styles.map((st) => ({ name: st.name, id: st.id })) }));
  }

  /** 文から音声（WAV）を作る */
  async synthesize(text: string, options: SynthesisOptions): Promise<Buffer> {
    const speaker = String(options.speakerId);
    const queryRes = await this.fetch(`/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
    const query = (await queryRes.json()) as Record<string, unknown>;
    query.speedScale = options.speed;
    query.volumeScale = options.volume;
    query.pitchScale = options.pitch;
    const audioRes = await this.fetch(`/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify(query),
    });
    return Buffer.from(await audioRes.arrayBuffer());
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new Error(`VOICEVOXにつながりません（${describeError(err)}）`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`VOICEVOXがエラーを返しました（HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}）`);
    }
    return res;
  }
}

/** WAVの長さ（ミリ秒）。読めなければ null */
export function wavDurationMs(wav: Buffer): number | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null;
  let byteRate: number | null = null;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= wav.length) byteRate = wav.readUInt32LE(offset + 8 + 8);
    if (id === 'data') {
      if (!byteRate) return null;
      const dataSize = Math.min(size, wav.length - offset - 8);
      return Math.round((dataSize / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export type SpeechStatus =
  | { state: 'disabled'; message: string }
  | { state: 'ok'; message: string; version: string }
  | { state: 'error'; message: string; hint: string };

const AUDIO_TTL_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 30_000;

export class SpeechService {
  readonly queue: ActionQueue<{ text: string }>;
  private readonly getSettings: () => Settings['voicevox'];
  private readonly hub: OverlayHub;
  private readonly log: AreaLogger;
  private status: SpeechStatus = { state: 'disabled', message: '使わない設定です' };
  private readonly audio = new Map<string, { data: Buffer; expires: number }>();
  private checkTimer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(options: { getSettings: () => Settings['voicevox']; hub: OverlayHub; log: AreaLogger }) {
    this.getSettings = options.getSettings;
    this.hub = options.hub;
    this.log = options.log;
    this.queue = new ActionQueue({
      name: 'speech',
      label: '読み上げ',
      log: this.log,
      run: ({ text }, signal) => this.play(text, signal),
    });
  }

  client(): VoicevoxClient {
    return new VoicevoxClient(this.getSettings().url);
  }

  getStatus(): SpeechStatus {
    return this.status;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 設定に合わせて、VOICEVOXの確認を始める（起動時・設定を変えた時） */
  restart(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    if (!this.getSettings().enabled) {
      this.setStatus({ state: 'disabled', message: '使わない設定です' });
      return;
    }
    void this.check();
    this.checkTimer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.checkTimer.unref();
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  /** VOICEVOXが動いているか確かめる */
  async check(): Promise<void> {
    if (!this.getSettings().enabled) return;
    try {
      const version = await this.client().version();
      if (this.status.state !== 'ok') this.log.info(`VOICEVOXにつながりました（バージョン ${version}）`);
      this.setStatus({ state: 'ok', message: `接続中（VOICEVOX ${version}）`, version });
    } catch (err) {
      if (this.status.state !== 'error') this.log.warn(describeError(err));
      this.setStatus({
        state: 'error',
        message: 'VOICEVOXにつながりません',
        hint: 'VOICEVOXのアプリを起動してください（自動で確認し直します）',
      });
    }
  }

  /** 読み上げを順番待ちに入れる */
  speak(text: string, label: string, onDone?: (error: unknown) => void): void {
    this.queue.push({ text }, label, { onDone });
  }

  /** 読み上げ用オーバーレイが取りに来る音声 */
  getAudio(id: string): Buffer | null {
    const item = this.audio.get(id);
    if (!item || item.expires < Date.now()) return null;
    return item.data;
  }

  private async play(rawText: string, signal: AbortSignal): Promise<void> {
    const settings = this.getSettings();
    const text = forSpeech(rawText, settings.maxChars);
    if (!text) return;
    if (this.hub.connected('speech') === 0) {
      throw new Error('読み上げ用オーバーレイ（speech）がOBSにつながっていません');
    }
    const wav = await this.client().synthesize(text, settings);
    if (signal.aborted) return;
    this.cleanupAudio();
    const id = randomUUID();
    this.audio.set(id, { data: wav, expires: Date.now() + AUDIO_TTL_MS });
    const durationMs = wavDurationMs(wav) ?? 5000;
    const sent = this.hub.send('speech', { type: 'speech', id, url: `/api/speech/audio/${id}.wav`, text });
    if (sent === 0) throw new Error('読み上げ用オーバーレイ（speech）がOBSにつながっていません');
    // 再生が終わるまで待つ（オーバーレイから「終わった」が来るか、音声の長さ＋少し）
    await this.hub.waitForAck(id, durationMs + 3000, signal);
    if (signal.aborted) this.hub.send('speech', { type: 'stop', id });
  }

  private cleanupAudio(): void {
    const now = Date.now();
    for (const [id, item] of this.audio) {
      if (item.expires < now) this.audio.delete(id);
    }
  }

  private setStatus(status: SpeechStatus): void {
    const changed = JSON.stringify(status) !== JSON.stringify(this.status);
    this.status = status;
    if (changed) for (const listener of this.listeners) listener();
  }
}

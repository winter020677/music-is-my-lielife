// メディア演出（要件 A-1・O-11）
//
// 動画・GIF・画像・効果音を、メディア用オーバーレイ（media）に出す。
//
// ・アラートとは別の順番待ちにする。アラートは数秒だが動画は長いことがあり、
//   同じ列にすると短いアラートが長い動画を待つことになるため（要件 Q-1 の考え方）。
// ・表示秒数を決めていない時は、オーバーレイから「終わった」の返事が来るまで待つ。
//   返事が来ないまま止まらないよう、上限の時間で打ち切る。

import { randomUUID } from 'node:crypto';
import type { OverlayHub } from './overlayHub.ts';
import { kindOf, type MediaKind, type MediaStore } from './mediaStore.ts';
import type { AreaLogger } from '../core/logger.ts';
import { ActionQueue, sleep } from '../core/queue.ts';

export interface MediaPayload {
  /** media フォルダの中のファイル名 */
  file: string;
  /** 画面の左からの位置（％。真ん中が50） */
  x: number;
  /** 画面の上からの位置（％。真ん中が50） */
  y: number;
  /** 大きさ（画面の幅に対する％） */
  width: number;
  /** 音量（0〜1） */
  volume: number;
  /** 表示する秒数。0なら、動画と音は最後まで／画像は既定の秒数 */
  durationSec: number;
}

/** 表示秒数を決めていない画像を、何秒出すか */
const IMAGE_DEFAULT_SEC = 5;

/** 「終わった」の返事を待つ上限（長い動画でも終われるように、余裕をもって10分） */
const MAX_WAIT_MS = 10 * 60 * 1000;

export class MediaService {
  readonly queue: ActionQueue<MediaPayload>;
  private readonly hub: OverlayHub;
  private readonly store: MediaStore;

  constructor(options: { hub: OverlayHub; store: MediaStore; log: AreaLogger }) {
    this.hub = options.hub;
    this.store = options.store;
    this.queue = new ActionQueue({
      name: 'media',
      label: 'メディア演出',
      log: options.log,
      run: (payload, signal) => this.show(payload, signal),
    });
  }

  /** 順番待ちに入れる。priority なら列の先頭へ（要件 A-6） */
  enqueue(payload: MediaPayload, label: string, options: { priority?: boolean; onDone?: (error: unknown) => void } = {}): void {
    this.queue.push(payload, label, options);
  }

  private async show(payload: MediaPayload, signal: AbortSignal): Promise<void> {
    const kind: MediaKind | null = this.store.has(payload.file) ? kindOf(payload.file) : null;
    if (!kind) {
      throw new Error(`メディアのファイルが見つかりません：${payload.file}（「ルール」画面で入れ直してください）`);
    }
    if (this.hub.connected('media') === 0) {
      throw new Error('メディア用オーバーレイ（media）がOBSにつながっていません');
    }

    const id = randomUUID();
    // 秒数を決めていない画像は、決まった秒数だけ出す（画像には「終わり」がないため）
    const durationSec = payload.durationSec > 0 ? payload.durationSec : kind === 'image' ? IMAGE_DEFAULT_SEC : 0;

    this.hub.send('media', {
      type: 'media',
      id,
      kind,
      url: `/media/${encodeURIComponent(payload.file)}`,
      x: payload.x,
      y: payload.y,
      width: payload.width,
      volume: payload.volume,
      durationMs: durationSec > 0 ? Math.round(durationSec * 1000) : 0,
    });

    if (durationSec > 0) {
      await sleep(Math.round(durationSec * 1000), signal);
    } else {
      // 動画・音の長さは本体では分からないので、オーバーレイの「終わった」を待つ
      await this.hub.waitForAck(id, MAX_WAIT_MS, signal);
    }
    // 途中で飛ばされた時と、上限で打ち切った時は、出したものを消させる
    this.hub.send('media', { type: 'stop', id });
  }
}

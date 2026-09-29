// スピナー（要件 6.5・O-12）
//
// ルールの「スピナーを回す」（A-5）や、管理画面の手動のボタンから回す。
//
// ・回っている間に次が来たら、順番待ちに入れて1つずつ回す（要件 S-3）
// ・当たりは本体側で決めてからオーバーレイに送る。
//   オーバーレイは「その当たりに止まる」ように見せるだけなので、
//   見た目の作りを変えても当たりやすさ（重み）は変わらない
// ・当たった項目の「やること」は、ルールと同じ仕組みで動かす（onResult で呼び出す）

import { pickSpinnerItem, type SpinnerItem } from '../config/rules.ts';
import type { Settings } from '../config/settings.ts';
import type { AreaLogger } from '../core/logger.ts';
import { ActionQueue, sleep } from '../core/queue.ts';
import type { OverlayHub } from './overlayHub.ts';

export interface SpinRequest {
  /** 当たった時に呼ぶ（当たった項目の「やること」を動かす） */
  onResult: (item: SpinnerItem) => void;
}

/** オーバーレイに送る、項目1つ分の見た目 */
interface SpinnerItemView {
  name: string;
  image: string | null;
  color: string;
  rarity: number;
}

export class SpinnerService {
  readonly queue: ActionQueue<SpinRequest>;
  private readonly hub: OverlayHub;
  private readonly getSettings: () => Settings['spinner'];
  private readonly random: () => number;
  private lastResult: { name: string; at: string } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(options: {
    hub: OverlayHub;
    getSettings: () => Settings['spinner'];
    log: AreaLogger;
    random?: () => number;
  }) {
    this.hub = options.hub;
    this.getSettings = options.getSettings;
    this.random = options.random ?? Math.random;
    this.queue = new ActionQueue({
      name: 'spinner',
      label: 'スピナー',
      log: options.log,
      run: (request, signal) => this.run(request, signal),
    });
  }

  /** 回せる状態か（使う設定になっていて、当たる項目が1つ以上ある） */
  ready(): boolean {
    const settings = this.getSettings();
    return settings.enabled && settings.items.some((item) => item.weight > 0);
  }

  /** 最後に当たったもの（管理画面に出す） */
  getLastResult(): { name: string; at: string } | null {
    return this.lastResult;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 順番待ちに入れる。priority なら列の先頭へ（要件 A-6） */
  enqueue(request: SpinRequest, label: string, options: { priority?: boolean; onDone?: (error: unknown) => void } = {}): void {
    this.queue.push(request, label, options);
  }

  private async run(request: SpinRequest, signal: AbortSignal): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enabled) throw new Error('スピナーを使わない設定になっています');

    const winner = pickSpinnerItem(settings.items, this.random);
    if (!winner) {
      throw new Error('スピナーの項目がありません（「スピナー」画面で追加してください）');
    }
    if (this.hub.connected('spinner') === 0) {
      throw new Error('スピナー用オーバーレイ（spinner）がOBSにつながっていません');
    }

    // 当たりやすさが0の項目は、回っている絵には出すが、当たりには選ばれない
    const items: SpinnerItemView[] = settings.items.map((item) => ({
      name: item.name,
      image: item.image ? `/media/${encodeURIComponent(item.image)}` : null,
      color: item.color,
      rarity: item.rarity,
    }));
    const winnerIndex = settings.items.indexOf(winner);

    this.hub.send('spinner', {
      type: 'spin',
      items,
      winnerIndex,
      spinMs: Math.round(settings.spinSec * 1000),
      resultMs: Math.round(settings.resultSec * 1000),
    });

    // 回り終わるまで待つ（当たりを見せる時間も含む）
    await sleep(Math.round((settings.spinSec + settings.resultSec) * 1000), signal);
    if (signal.aborted) {
      this.hub.send('spinner', { type: 'stop' });
      return;
    }

    this.lastResult = { name: winner.name, at: new Date().toISOString() };
    for (const listener of this.listeners) listener();

    // 当たった項目の「やること」を動かす（要件 S-2）
    request.onResult(winner);
  }
}

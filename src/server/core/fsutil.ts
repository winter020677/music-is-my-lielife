// ファイル操作の小さな道具

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * ファイルを安全に書き換える（要件 N-3）。
 * いったん一時ファイルに全部書いてから、本物と入れ替える。
 * 途中でPCが落ちても「半分だけ書かれた壊れたファイル」にならない。
 */
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    if (typeof data === 'string') writeSync(fd, data, null, 'utf8');
    else writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameWithRetry(tmp, file);
}

/**
 * Windowsでは、ウイルス対策ソフトなどがファイルを一瞬つかんでいて
 * 入れ替えに失敗することがあるので、少し待って何度か試す。
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retryable || attempt >= 10) {
        rmSync(from, { force: true });
        throw err;
      }
      sleepSync(50 * (attempt + 1));
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

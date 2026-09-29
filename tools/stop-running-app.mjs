// 本体が起動していたら、終了してよいか聞いてから終了する（更新・セットアップの前に使う）
// 動いている本体のファイルを入れ替えると、うまく更新できないことがあるため。

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

function readPort() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const match = /^\s*PORT\s*=\s*(\d+)/m.exec(text);
    if (match) return Number(match[1]);
  } catch {
    // .env がなければ初期値
  }
  return 3939;
}

const port = readPort();
const base = `http://127.0.0.1:${port}`;

async function isRunning() {
  try {
    const res = await fetch(`${base}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === 'tiktok-live-tool';
  } catch {
    return false;
  }
}

if (await isRunning()) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('本体が起動しています。終了してから進めます。配信の記録も止まりますが、終了してよいですか？（y＝はい / n＝いいえ）：');
  rl.close();
  if (!/^y/i.test(answer.trim())) {
    console.log('やめました。本体を終了してから、もう一度実行してください。');
    process.exit(1);
  }
  await fetch(`${base}/api/app/quit`, { method: 'POST', headers: { Origin: base } }).catch(() => {});
  for (let i = 0; i < 30 && (await isRunning()); i++) await new Promise((r) => setTimeout(r, 500));
  console.log('本体を終了しました。');
}

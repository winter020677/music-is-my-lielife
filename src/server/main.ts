// 本体の入り口（起動した時に最初に動くファイル）
//
//   node src/server/main.ts          … 本体を起動する
//   node src/server/main.ts --open   … 起動して、管理画面のウィンドウも開く（デスクトップのショートカットはこれ）
//
// すでに起動している時にもう一度ダブルクリックした場合は、管理画面のウィンドウだけ開く。

import { join } from 'node:path';
import { App, APP_NAME } from './app.ts';
import { PROJECT_ROOT, resolveDataDir, resolvePaths } from './config/paths.ts';
import { SecretStore } from './config/secrets.ts';
import { describeError, Logger } from './core/logger.ts';
import { openAdminWindow, showMessageBox } from './util/windows.ts';
import { createWebServer, HOST } from './web/server.ts';

const DEFAULT_PORT = 3939;

async function main(): Promise<void> {
  const shouldOpen = process.argv.includes('--open');
  const logger = new Logger({ toConsole: true });

  // .env の PORT と DATA_DIR を先に読む
  const env = new SecretStore(join(PROJECT_ROOT, '.env'));
  env.load();
  const port = parsePort(env.get('PORT') || process.env.PORT) ?? DEFAULT_PORT;
  const dataDir = resolveDataDir({ ...process.env, DATA_DIR: env.get('DATA_DIR') || process.env.DATA_DIR });
  const paths = resolvePaths(dataDir);
  logger.setDirectory(paths.logDir);
  const log = logger.area('起動');

  // 思わぬエラーが起きても、記録や接続を止めない（要件 N-2）
  process.on('uncaughtException', (err) => logger.area('本体').error('予期しないエラー（動作は続けます）', err));
  process.on('unhandledRejection', (err) => logger.area('本体').error('予期しないエラー（動作は続けます）', err));

  const url = `http://127.0.0.1:${port}/`;
  if (await isAlreadyRunning(port)) {
    log.info('すでに起動しているので、管理画面のウィンドウだけ開きます');
    if (shouldOpen) openAdminWindow(url, paths.edgeProfileDir, log);
    return;
  }

  log.info(`${APP_NAME} を起動します（データの場所：${paths.dataDir}）`);
  const app = await App.create({ paths, logger, port });
  const server = await createWebServer(app);
  try {
    await server.listen({ port, host: HOST });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message =
      code === 'EADDRINUSE'
        ? `ポート ${port} を別のアプリが使っています。プロジェクトの .env に「PORT=3940」のように別の番号を書いてから、もう一度起動してください`
        : `起動できませんでした（${describeError(err)}）`;
    log.error(message);
    showMessageBox(APP_NAME, message);
    await app.stop();
    process.exitCode = 1;
    return;
  }

  app.start();
  log.info(`起動しました。管理画面：${url}  オーバーレイ：${url}overlay/`);
  if (shouldOpen) openAdminWindow(url, paths.edgeProfileDir, log);

  let stopping = false;
  const shutdown = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`終了します（${reason}）`);
    // Minecraftサーバーが動いている時は、ワールドの保存（最長60秒で強制終了）を待てるように長めにする
    const force = setTimeout(() => process.exit(0), app.minecraftServer.isRunning() ? 90_000 : 10_000);
    force.unref();
    try {
      await server.close();
    } catch {
      // 閉じられなくても続ける
    }
    await app.stop();
    process.exit(0);
  };
  app.onQuit(() => void shutdown('管理画面の「終了」ボタン'));
  process.on('SIGINT', () => void shutdown('Ctrl+C'));
  process.on('SIGTERM', () => void shutdown('終了の合図'));
}

function parsePort(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/** 同じポートで、このアプリがもう動いているか */
async function isAlreadyRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: string };
    return body.app === 'tiktok-live-tool';
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  showMessageBox(APP_NAME, `起動できませんでした：${describeError(err)}`);
  process.exitCode = 1;
});

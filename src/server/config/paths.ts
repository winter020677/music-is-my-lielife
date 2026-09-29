// ファイルやフォルダの場所
//
// 配信の記録（データベース）と設定は「データフォルダ」に置く。
// ・Windowsでは %LOCALAPPDATA%\TikTokLiveTool（例：C:\Users\あなた\AppData\Local\TikTokLiveTool）
//   → プロジェクトのフォルダを消したり、GitHubから取り直したりしても、記録が消えないように、
//     プロジェクトとは別の場所にしている。OneDriveの同期対象にもならない場所。
// ・.env に DATA_DIR=... と書けば、好きな場所に変えられる。
// ・Windows以外（開発用）では、プロジェクトの中の data フォルダ。

import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** このプロジェクトのフォルダ（src/server/config から3つ上） */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const DATA_FOLDER_NAME = 'TikTokLiveTool';

export interface AppPaths {
  projectRoot: string;
  dataDir: string;
  settingsFile: string;
  dbFile: string;
  defaultBackupDir: string;
  logDir: string;
  envFile: string;
  adminDist: string;
  overlaysDir: string;
  edgeProfileDir: string;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const custom = env.DATA_DIR?.trim();
  if (custom) return isAbsolute(custom) ? custom : resolve(PROJECT_ROOT, custom);
  if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, DATA_FOLDER_NAME);
  return join(PROJECT_ROOT, 'data');
}

export function resolvePaths(dataDir: string, projectRoot: string = PROJECT_ROOT): AppPaths {
  return {
    projectRoot,
    dataDir,
    settingsFile: join(dataDir, 'settings.json'),
    dbFile: join(dataDir, 'live.db'),
    defaultBackupDir: join(dataDir, 'backups'),
    logDir: join(dataDir, 'logs'),
    envFile: join(projectRoot, '.env'),
    adminDist: join(projectRoot, 'dist', 'admin'),
    overlaysDir: join(projectRoot, 'overlays'),
    edgeProfileDir: join(dataDir, 'window'),
  };
}

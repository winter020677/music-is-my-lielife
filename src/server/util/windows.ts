// Windowsの画面まわり（管理画面のウィンドウを開く、メッセージを出す）

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaLogger } from '../core/logger.ts';

/**
 * 管理画面を「アプリ風の独立ウィンドウ」で開く（要件 U-1）。
 * Windows 11に最初から入っている Microsoft Edge の「アプリモード」を使う
 * （アドレスバーやタブのない、専用のウィンドウになる）。
 */
export function openAdminWindow(url: string, profileDir: string, log: AreaLogger): void {
  if (process.platform !== 'win32') {
    log.info(`管理画面を開くには、ブラウザで ${url} を開いてください`);
    return;
  }
  const edge = findEdge();
  try {
    if (edge) {
      mkdirSync(profileDir, { recursive: true });
      spawn(
        edge,
        [
          `--app=${url}`,
          `--user-data-dir=${profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1440,920',
        ],
        { detached: true, stdio: 'ignore' },
      ).unref();
    } else {
      // Edgeが見つからない時は、ふだんのブラウザで開く
      spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } catch (err) {
    log.error('管理画面のウィンドウを開けませんでした', err);
  }
}

function findEdge(): string | null {
  const candidates = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

/**
 * Windowsのメッセージを出す（黒い画面がないので、起動できない時などに使う）。
 * 文字はPowerShellに環境変数で渡す（日本語や記号でも崩れないように）。
 */
export function showMessageBox(title: string, message: string): void {
  if (process.platform !== 'win32') {
    console.error(`${title}: ${message}`);
    return;
  }
  try {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:TLT_MESSAGE, $env:TLT_TITLE) | Out-Null',
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, TLT_MESSAGE: message, TLT_TITLE: title },
      },
    ).unref();
  } catch {
    // 出せなくても困らない
  }
}

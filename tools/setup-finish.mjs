// セットアップの仕上げ（setup.bat から呼ばれる）
// ・.env がなければ .env.example から作る
// ・デスクトップにショートカットを作る（ダブルクリックで本体が起動し、管理画面が開く）

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHORTCUT_NAME = 'TikTok LIVE ツール';

// .env を用意する
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(join(root, '.env.example'), envFile);
  console.log('.env を作りました（APIキーなどは、管理画面の「設定」→「秘密情報」から入力できます）');
}

// デスクトップのショートカット
if (process.platform === 'win32') {
  // PowerShellに渡す命令。日本語や " は命令の文字に入れず、環境変数で渡す（文字化け・引用符の崩れを防ぐ）
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$link = Join-Path $desktop ($env:TLT_NAME + '.lnk')",
    '$shell = New-Object -ComObject WScript.Shell',
    '$s = $shell.CreateShortcut($link)',
    "$s.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'",
    "$s.Arguments = [char]34 + (Join-Path $env:TLT_ROOT 'start.vbs') + [char]34",
    '$s.WorkingDirectory = $env:TLT_ROOT',
    "$s.IconLocation = (Join-Path $env:TLT_ROOT 'assets\\app.ico') + ',0'",
    '$s.Description = $env:TLT_DESC',
    '$s.Save()',
    'Write-Output $link',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, TLT_ROOT: root, TLT_NAME: SHORTCUT_NAME, TLT_DESC: 'TikTok LIVE ツールを起動します' },
    encoding: 'utf8',
  });
  if (result.status === 0) {
    console.log(`デスクトップにショートカットを作りました：${result.stdout.trim()}`);
  } else {
    console.log('デスクトップのショートカットを作れませんでした。start.vbs をダブルクリックしても起動できます。');
    if (result.stderr) console.log(result.stderr.trim());
  }
}

console.log('');
console.log('セットアップが終わりました。');
console.log(`  1. デスクトップの「${SHORTCUT_NAME}」をダブルクリックすると、本体が起動して管理画面が開きます`);
console.log('  2. 管理画面の「設定」で、TikTokのユーザー名と、秘密情報（Euler StreamのAPIキーなど）を入れて「保存」');
console.log('  3. 管理画面の「オーバーレイ」に出ているURLを、OBSのブラウザソースに入れます');

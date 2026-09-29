// 自動テストの設定（npm test で動く）
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // node:sqlite の「実験的な機能です」という注意を出さない
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});

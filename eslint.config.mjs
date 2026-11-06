import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'var/**',
      // 独立 Node 冒烟脚本（运行时脚本，非 TS 项目源码）
      'scripts/**',
      // 被工作台托管的「真实项目」fixture（外部受管项目，非工作台源码）
      'tests/integration/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);

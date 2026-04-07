import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    ignores: ['dist/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/linebreak-style': ['error', 'unix'],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/keyword-spacing': ['error', {
        before: true,
        after: true,
      }],
      '@stylistic/arrow-spacing': ['error', {
        before: true,
        after: true,
      }],
      '@stylistic/comma-spacing': ['error', {
        before: false,
        after: true,
      }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/object-curly-spacing': ['error', 'always', { objectsInObjects: false }],
      '@stylistic/object-curly-newline': ['error', { multiline: true, consistent: true }],
      'no-multi-spaces': 'error',
      'no-trailing-spaces': 'error',
      'no-undef': 'off',
    },
  },
])

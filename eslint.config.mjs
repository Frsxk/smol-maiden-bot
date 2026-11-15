import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['node_modules/**', 'dist/**', '.test-dist/**'] },
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
            '@typescript-eslint/no-misused-promises': 'error',
        },
    },
    {
        files: ['test/**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': ['error', {
                ignoreVoid: false,
                // node:test owns completion and rejection handling for registered tests.
                allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'suite', 'describe'] }],
            }],
            // Deterministic async fakes keep the production promise contract without real I/O.
            '@typescript-eslint/require-await': 'off',
        },
    },
);

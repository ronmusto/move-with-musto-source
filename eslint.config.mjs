import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    {
        ignores: ['.next/**', 'coverage/**', 'coverage-full/**', 'out/**', 'coming-soon-out/**', 'dist/**', 'next-env.d.ts', '**/node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            'no-debugger': 'error',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
        },
    },
    {
        files: ['infrastructure/mls-ingestion/handlers/build-source.mjs', 'infrastructure/mls-ingestion/handlers/contact-domain.mjs'],
        // These security validators intentionally detect and reject C0 control characters.
        rules: { 'no-control-regex': 'off' },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            // Synchronization effects are checked without requiring React Compiler.
            'react-hooks/exhaustive-deps': 'error',
        },
    },
);

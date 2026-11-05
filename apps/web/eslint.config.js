import { nextJsConfig } from '@repo/eslint-config/next-js'

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...nextJsConfig,
    {
        // TypeScript types replace runtime prop-types.
        rules: { 'react/prop-types': 'off' },
    },
    {
        // Node CLI scripts (lint-design, contrast, screenshots). screenshots.mjs
        // also passes callbacks that run in the browser.
        files: ['scripts/**'],
        languageOptions: {
            globals: {
                process: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                document: 'readonly',
                window: 'readonly',
            },
        },
    },
]

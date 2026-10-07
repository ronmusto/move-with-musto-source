import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Publication CLIs run natively in Node; avoid transforming their hashbangs.
        server: { deps: { external: [/[/\\]scripts[/\\](?:check-mls-publication|publish-mls-assets)\.mjs$/] } },
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        testTimeout: 30000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: [
                'src/lib/coming-soon-config.ts',
                'src/features/coming-soon/*.tsx',
                'src/app/**/*.tsx',
            ],
            exclude: [
                '**/*.d.ts',
                'src/**/*.test.ts',
                'src/**/*.test.tsx',
                'src/**/*.spec.ts',
                'src/**/*.spec.tsx',
            ],
            thresholds: {
                statements: 80,
                branches: 80,
                functions: 80,
                lines: 80,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});

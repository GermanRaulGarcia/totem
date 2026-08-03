import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // El E2E vive en e2e/ y usa el test runner de Playwright, no el de vitest.
        exclude: [...configDefaults.exclude, 'e2e/**']
    }
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    use: { baseURL: 'http://127.0.0.1:5173' },
    webServer: {
        // --host 127.0.0.1 es necesario: en este entorno "localhost" resuelve a
        // ::1 (IPv6) y Playwright sondea la url por IPv4, dejando el webServer
        // en timeout aunque Vite este arriba.
        command: 'npm run dev -- --port 5173 --host 127.0.0.1',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: true
    }
});

import { describe, it, expect } from 'vitest';

describe('andamiaje', () => {
    it('ejecuta TypeScript en modo estricto', () => {
        const sedes: readonly string[] = ['lorca', 'canarias'];
        expect(sedes).toHaveLength(2);
    });
});

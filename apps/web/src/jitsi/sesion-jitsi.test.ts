import { describe, it, expect, vi } from 'vitest';
import { SesionJitsi, type ApiJitsi } from './sesion-jitsi';

function dobleApi() {
    const api: ApiJitsi = {
        executeCommand: vi.fn(),
        addEventListener: vi.fn(),
        dispose: vi.fn(),
        isAudioMuted: vi.fn(async () => true)
    };
    return api;
}

describe('SesionJitsi', () => {
    const contenedor = () => ({ } as unknown as HTMLElement);

    it('no hay sesion activa al principio', () => {
        const s = new SesionJitsi(() => dobleApi(), contenedor(), 'Lorca');
        expect(s.activa).toBe(false);
    });

    it('crear levanta la sesion', () => {
        const api = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        expect(s.activa).toBe(true);
    });

    it('destruir llama a dispose y deja la sesion inactiva', () => {
        const api = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.destruir();
        expect(api.dispose).toHaveBeenCalledTimes(1);
        expect(s.activa).toBe(false);
    });

    it('crear dos veces seguidas destruye la anterior: nunca dos iframes', () => {
        const primera = dobleApi();
        const segunda = dobleApi();
        const apis = [primera, segunda];
        let i = 0;
        const s = new SesionJitsi(() => apis[i++]!, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.crear('spm-2');
        expect(primera.dispose).toHaveBeenCalledTimes(1);
        expect(s.activa).toBe(true);
    });

    it('destruir sin sesion activa no revienta ni llama a dispose', () => {
        const api = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        expect(() => s.destruir()).not.toThrow();
        expect(api.dispose).not.toHaveBeenCalled();
    });

    it('destruir dos veces solo hace dispose una vez', () => {
        const api = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.destruir();
        s.destruir();
        expect(api.dispose).toHaveBeenCalledTimes(1);
    });
});

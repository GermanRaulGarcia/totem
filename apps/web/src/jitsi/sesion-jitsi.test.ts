import { describe, it, expect, vi } from 'vitest';
import { SesionJitsi, type ApiJitsi } from './sesion-jitsi';

function dobleApi(): { api: ApiJitsi; invocarListener: () => void } {
    let listener: ((datos: never) => void) | null = null;
    const api: ApiJitsi = {
        executeCommand: vi.fn(),
        addEventListener: vi.fn((evento: string, cb: (datos: never) => void) => {
            if (evento === 'videoConferenceLeft') {
                listener = cb;
            }
        }),
        dispose: vi.fn(),
        isAudioMuted: vi.fn(async () => true)
    };
    return {
        api,
        invocarListener: () => {
            (listener as any)?.();
        }
    };
}

describe('SesionJitsi', () => {
    const contenedor = () => ({ } as unknown as HTMLElement);

    it('no hay sesion activa al principio', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        expect(s.activa).toBe(false);
    });

    it('crear levanta la sesion', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        expect(s.activa).toBe(true);
    });

    it('destruir llama a dispose y deja la sesion inactiva', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.destruir();
        expect(api.dispose).toHaveBeenCalledTimes(1);
        expect(s.activa).toBe(false);
    });

    it('crear dos veces seguidas destruye la anterior: nunca dos iframes', () => {
        const { api: primera } = dobleApi();
        const { api: segunda } = dobleApi();
        const apis = [primera, segunda];
        let i = 0;
        const s = new SesionJitsi(() => apis[i++]!, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.crear('spm-2');
        expect(primera.dispose).toHaveBeenCalledTimes(1);
        expect(s.activa).toBe(true);
    });

    it('destruir sin sesion activa no revienta ni llama a dispose', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        expect(() => s.destruir()).not.toThrow();
        expect(api.dispose).not.toHaveBeenCalled();
    });

    it('destruir dos veces solo hace dispose una vez', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');
        s.destruir();
        s.destruir();
        expect(api.dispose).toHaveBeenCalledTimes(1);
    });

    it('alFallar callback dispara cuando el listener de videoConferenceLeft se invoca', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        invocarListener();
        expect(fallo).toBe(true);
    });

    it('stale listener no dispara despues de nuevo crear', () => {
        const primera = dobleApi();
        const segunda = dobleApi();
        const apis = [primera.api, segunda.api];
        let i = 0;
        const s = new SesionJitsi(() => apis[i++]!, contenedor(), 'Lorca');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        s.crear('spm-1');
        s.crear('spm-2');

        // Invocar el listener de la primera sesion (que deberia estar muerta)
        primera.invocarListener();

        // El callback no deberia dispararse
        expect(fallo).toBe(false);
    });

    it('disposed listener no dispara el callback', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor(), 'Lorca');
        s.crear('spm-1');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        s.destruir();
        invocarListener();

        expect(fallo).toBe(false);
    });
});

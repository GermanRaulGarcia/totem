// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SesionJitsi, type ApiJitsi } from './sesion-jitsi';

interface DobleApi {
    api: ApiJitsi;
    invocarListener: (evento: string, datos?: unknown) => void;
}

function dobleApi(): DobleApi {
    const listeners = new Map<string, (datos: unknown) => void>();
    return {
        api: {
            executeCommand: vi.fn(),
            addEventListener: vi.fn((evento: string, cb: (datos: unknown) => void) => {
                listeners.set(evento, cb);
            }),
            dispose: vi.fn(),
            isAudioMuted: vi.fn(async () => true)
        },
        invocarListener: (evento, datos) => { listeners.get(evento)?.(datos); }
    };
}

describe('SesionJitsi', () => {
    const contenedor = () => document.createElement('div');

    it('no hay sesion activa al principio', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        expect(s.activa).toBe(false);
    });

    it('crear levanta la sesion', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        s.crear('spm-1');
        expect(s.activa).toBe(true);
    });

    describe('unido: la senal que deja pasar a la miniatura propia', () => {
        // Existe por una incidencia en produccion: la miniatura abria la camara a
        // la vez que Jitsi, y en una camara que no admite dos aperturas gana el
        // primero. Lorca envio audio sin video durante una manaña, con su
        // miniatura viendose perfecta. Esperando a esta senal, Jitsi coge la
        // camara primero SIEMPRE.
        it('crear todavia NO cuenta como unido', () => {
            const { api } = dobleApi();
            const s = new SesionJitsi(() => api, contenedor, 'Lorca');
            s.crear('spm-1');
            expect(s.unido).toBe(false);
        });

        it('lo es cuando Jitsi confirma que ha entrado', () => {
            const { api, invocarListener } = dobleApi();
            const s = new SesionJitsi(() => api, contenedor, 'Lorca');
            s.crear('spm-1');
            invocarListener('videoConferenceJoined');
            expect(s.unido).toBe(true);
        });

        it('deja de serlo al destruir, para que la camara no siga abierta', () => {
            const { api, invocarListener } = dobleApi();
            const s = new SesionJitsi(() => api, contenedor, 'Lorca');
            s.crear('spm-1');
            invocarListener('videoConferenceJoined');

            s.destruir();
            expect(s.unido).toBe(false);
        });

        it('una sesion nueva empieza sin unir aunque la anterior lo estuviera', () => {
            const primera = dobleApi();
            const segunda = dobleApi();
            let toca = primera;
            const s = new SesionJitsi(() => toca.api, contenedor, 'Lorca');

            s.crear('spm-1');
            primera.invocarListener('videoConferenceJoined');
            expect(s.unido).toBe(true);

            toca = segunda;
            s.crear('spm-2');
            expect(s.unido).toBe(false);
        });
    });

    it('destruir llama a dispose y deja la sesion inactiva', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
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
        const s = new SesionJitsi(() => apis[i++]!, contenedor, 'Lorca');
        s.crear('spm-1');
        s.crear('spm-2');
        expect(primera.dispose).toHaveBeenCalledTimes(1);
        expect(s.activa).toBe(true);
    });

    it('destruir sin sesion activa no revienta ni llama a dispose', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        expect(() => s.destruir()).not.toThrow();
        expect(api.dispose).not.toHaveBeenCalled();
    });

    it('destruir dos veces solo hace dispose una vez', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        s.crear('spm-1');
        s.destruir();
        s.destruir();
        expect(api.dispose).toHaveBeenCalledTimes(1);
    });

    it('alFallar callback dispara cuando el listener de videoConferenceLeft se invoca', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        s.crear('spm-1');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        invocarListener('videoConferenceLeft');
        expect(fallo).toBe(true);
    });

    it('stale listener no dispara despues de nuevo crear', () => {
        const primera = dobleApi();
        const segunda = dobleApi();
        const apis = [primera.api, segunda.api];
        let i = 0;
        const s = new SesionJitsi(() => apis[i++]!, contenedor, 'Lorca');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        s.crear('spm-1');
        s.crear('spm-2');

        // Invocar el listener de la primera sesion (que deberia estar muerta)
        primera.invocarListener('videoConferenceLeft');

        // El callback no deberia dispararse
        expect(fallo).toBe(false);
    });

    it('disposed listener no dispara el callback', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, contenedor, 'Lorca');
        s.crear('spm-1');

        let fallo = false;
        s.alFallar(() => { fallo = true; });

        s.destruir();
        invocarListener('videoConferenceLeft');

        expect(fallo).toBe(false);
    });
});

describe('SesionJitsi: donde se monta el iframe', () => {
    // El E2E comprobaba `#jitsi` visible, lo cual es cierto y no significa nada: el
    // div es `position: fixed` y esta vacio. Lo que importa es a QUE nodo se le
    // entrega el iframe a Jitsi, porque montarlo en `<main>` lo deja a y = 100dvh,
    // fuera de la pantalla de un kiosco que no puede hacer scroll: audio sin video.
    it('entrega a la fabrica el contenedor resuelto en el momento de crear', () => {
        const raiz = document.createElement('div');
        raiz.innerHTML = '<section><div id="jitsi"></div></section>';

        const { api } = dobleApi();
        let recibido: HTMLElement | null = null;
        const s = new SesionJitsi(
            (_sala, padre) => { recibido = padre; return api; },
            () => raiz.querySelector<HTMLElement>('#jitsi'),
            'Lorca'
        );

        s.crear('spm-1');
        expect(recibido).not.toBeNull();
        expect(recibido).toBe(raiz.querySelector('#jitsi'));
    });

    it('el contenedor se busca al crear, no al construir', () => {
        const raiz = document.createElement('div');
        const { api } = dobleApi();
        let recibido: HTMLElement | null = null;
        const s = new SesionJitsi(
            (_sala, padre) => { recibido = padre; return api; },
            () => raiz.querySelector<HTMLElement>('#jitsi'),
            'Lorca'
        );

        // El contenedor aparece DESPUES de construir la sesion, igual que en la app:
        // `#jitsi` solo existe cuando esta pintada la pantalla de llamada.
        raiz.innerHTML = '<div id="jitsi"></div>';
        s.crear('spm-1');

        expect(recibido).toBe(raiz.querySelector('#jitsi'));
    });

    it('si no existe el contenedor avisa del fallo en vez de crear a ciegas', () => {
        const raiz = document.createElement('div');
        const { api } = dobleApi();
        const fabrica = vi.fn(() => api);
        const s = new SesionJitsi(fabrica, () => raiz.querySelector<HTMLElement>('#jitsi'), 'Lorca');

        let fallo = false;
        s.alFallar(() => { fallo = true; });
        s.crear('spm-1');

        expect(fabrica).not.toHaveBeenCalled();
        expect(fallo).toBe(true);
        expect(s.activa).toBe(false);
    });
});

describe('SesionJitsi: fallos de arranque', () => {
    it('si la fabrica lanza (external_api.js ausente) emite fallo y no queda sesion', () => {
        const s = new SesionJitsi(
            () => { throw new TypeError('JitsiMeetExternalAPI is not a constructor'); },
            () => document.createElement('div'),
            'Lorca'
        );

        let fallos = 0;
        s.alFallar(() => { fallos++; });
        expect(() => s.crear('spm-1')).not.toThrow();

        expect(fallos).toBe(1);
        expect(s.activa).toBe(false);
    });

    it('avisa cuando se ha entrado realmente en la sala', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');

        let unido = 0;
        s.alUnirse(() => { unido++; });
        s.crear('spm-1');
        invocarListener('videoConferenceJoined');

        expect(unido).toBe(1);
    });
});

describe('SesionJitsi: micro y camara idempotentes', () => {
    it('fijar el mismo estado dos veces no alterna dos veces', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');
        s.crear('spm-1');

        s.fijarMicroSilenciado(true);
        s.fijarMicroSilenciado(true);
        s.fijarMicroSilenciado(true);

        expect(api.executeCommand).toHaveBeenCalledTimes(1);
        expect(api.executeCommand).toHaveBeenCalledWith('toggleAudio');
        expect(s.silenciado).toBe(true);
    });

    it('sigue el estado real que reporta Jitsi, no el que supone', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');
        s.crear('spm-1');

        // Jitsi silencia por su cuenta (p. ej. moderacion o dispositivo ocupado).
        invocarListener('audioMuteStatusChanged', { muted: true });
        expect(s.silenciado).toBe(true);

        // Pedir silencio ahora no debe volver a alternar: ya esta silenciado.
        s.fijarMicroSilenciado(true);
        expect(api.executeCommand).not.toHaveBeenCalled();

        // Y quitarlo alterna exactamente una vez.
        s.fijarMicroSilenciado(false);
        expect(api.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('la camara se maneja igual, con toggleVideo', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');
        s.crear('spm-1');

        s.alternarCamara();
        expect(api.executeCommand).toHaveBeenCalledWith('toggleVideo');
        invocarListener('videoMuteStatusChanged', { muted: true });
        expect(s.camaraOculta).toBe(true);

        s.fijarCamaraApagada(true);
        expect(api.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('sin sesion activa no se ejecuta ningun comando', () => {
        const { api } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');
        s.fijarMicroSilenciado(true);
        s.alternarCamara();
        expect(api.executeCommand).not.toHaveBeenCalled();
    });

    it('una sesion nueva arranca con micro y camara abiertos', () => {
        const { api, invocarListener } = dobleApi();
        const s = new SesionJitsi(() => api, () => document.createElement('div'), 'Lorca');
        s.crear('spm-1');
        invocarListener('audioMuteStatusChanged', { muted: true });
        s.destruir();
        s.crear('spm-2');
        expect(s.silenciado).toBe(false);
        expect(s.camaraOculta).toBe(false);
    });
});

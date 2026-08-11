// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { AutoVista } from './autovista';

function flujoFalso() {
    const pistas = [{ stop: vi.fn() }, { stop: vi.fn() }];
    return { pistas, flujo: { getTracks: () => pistas } as unknown as MediaStream };
}

/** Un <video> colgado del documento: `isConnected` es parte de lo que se prueba. */
function videoEnPantalla(): HTMLVideoElement {
    const v = document.createElement('video');
    document.body.appendChild(v);
    return v;
}

describe('AutoVista', () => {
    it('pide la camara y la engancha al video', async () => {
        const { flujo } = flujoFalso();
        const av = new AutoVista({ pedirCamara: () => Promise.resolve(flujo) });
        const video = videoEnPantalla();

        await av.mostrar(video);
        expect(video.srcObject).toBe(flujo);
        expect(av.activa).toBe(true);
    });

    it('pide la camara UNA vez aunque se repinte muchas', async () => {
        // `mostrar` se llama desde cada repintado, y el reloj repinta cada segundo.
        const pedir = vi.fn(() => Promise.resolve(flujoFalso().flujo));
        const av = new AutoVista({ pedirCamara: pedir });
        const video = videoEnPantalla();

        await Promise.all([av.mostrar(video), av.mostrar(video), av.mostrar(video)]);
        await av.mostrar(video);
        expect(pedir).toHaveBeenCalledTimes(1);
    });

    it('al ocultar suelta las pistas: el piloto de la camara se apaga', async () => {
        const { pistas, flujo } = flujoFalso();
        const av = new AutoVista({ pedirCamara: () => Promise.resolve(flujo) });
        await av.mostrar(videoEnPantalla());

        av.ocultar();
        for (const p of pistas) expect(p.stop).toHaveBeenCalled();
        expect(av.activa).toBe(false);
    });

    it('si la llamada acaba mientras se pedia la camara, no la deja abierta', async () => {
        // La ventana entre pedir la camara y recibirla es real, y colgar dentro de
        // ella dejaria el flujo vivo EN REPOSO: invisible, y justo lo que este
        // proyecto existe para eliminar.
        const { pistas, flujo } = flujoFalso();
        const av = new AutoVista({ pedirCamara: () => Promise.resolve(flujo) });
        const video = document.createElement('video'); // nunca llega al documento

        await av.mostrar(video);
        for (const p of pistas) expect(p.stop).toHaveBeenCalled();
        expect(av.activa).toBe(false);
    });

    it('si la camara falla, no lanza: la llamada sigue sin miniatura', async () => {
        // La conversacion va por Jitsi. Camara ocupada, permiso denegado o driver
        // que no admite dos aperturas no pueden tumbarla.
        const av = new AutoVista({ pedirCamara: () => Promise.reject(new Error('ocupada')) });
        await expect(av.mostrar(videoEnPantalla())).resolves.toBeUndefined();
        expect(av.activa).toBe(false);
    });

    it('ocultar sin haber mostrado no hace nada', () => {
        expect(() => new AutoVista().ocultar()).not.toThrow();
    });
});

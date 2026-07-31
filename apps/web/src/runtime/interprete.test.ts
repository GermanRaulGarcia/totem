import { describe, it, expect, vi } from 'vitest';
import { Interprete } from './interprete';
import type { Efecto } from '../core/tipos';

/** Promesa que se resuelve cuando el test quiere, para fijar el orden real. */
function diferida(): { promesa: Promise<void>; resolver: () => void } {
    let resolver: () => void = () => {};
    const promesa = new Promise<void>(r => { resolver = r; });
    return { promesa, resolver };
}

/** Cede el turno unas cuantas veces para que corran las microtareas pendientes. */
async function tics(cuantos = 5): Promise<void> {
    for (let i = 0; i < cuantos; i++) await Promise.resolve();
}

function dobles() {
    const mqtt = {
        publicarEstado: vi.fn(async () => {}),
        publicarInvitacion: vi.fn(async () => {}),
        publicarEventoLlamada: vi.fn(async () => {})
    };
    const jitsi = { crear: vi.fn(), destruir: vi.fn() };
    const sonidos = {
        sonarTimbre: vi.fn(), pararTimbre: vi.fn(),
        sonarRingback: vi.fn(), pararRingback: vi.fn()
    };
    const timers = { arrancar: vi.fn(), cancelar: vi.fn() };
    const perdidas: string[] = [];
    const interprete = new Interprete(
        mqtt as never, jitsi as never, sonidos, timers,
        'lorca', o => { perdidas.push(o); }, () => {}
    );
    return { mqtt, jitsi, sonidos, timers, perdidas, interprete };
}

describe('Interprete', () => {
    it('publica una invitacion por cada destino', async () => {
        const d = dobles();
        const efecto: Efecto = {
            tipo: 'publicar-invitaciones', callId: 'c1', sala: 'spm-c1',
            destinos: ['murcia', 'canarias']
        };
        await d.interprete.ejecutar([efecto]);
        expect(d.mqtt.publicarInvitacion).toHaveBeenCalledTimes(2);
        expect(d.mqtt.publicarInvitacion).toHaveBeenCalledWith('murcia', expect.objectContaining({
            callId: 'c1', sala: 'spm-c1', origen: 'lorca'
        }));
    });

    it('crea la sesion de Jitsi', async () => {
        const d = dobles();
        await d.interprete.ejecutar([{ tipo: 'crear-jitsi', sala: 'spm-c1' }]);
        expect(d.jitsi.crear).toHaveBeenCalledWith('spm-c1');
    });

    it('destruye la sesion de Jitsi', async () => {
        const d = dobles();
        await d.interprete.ejecutar([{ tipo: 'destruir-jitsi' }]);
        expect(d.jitsi.destruir).toHaveBeenCalledTimes(1);
    });

    it('registra una llamada perdida', async () => {
        const d = dobles();
        await d.interprete.ejecutar([{ tipo: 'registrar-perdida', origen: 'murcia' }]);
        expect(d.perdidas).toEqual(['murcia']);
    });

    it('espera a que termine un efecto asincrono antes de lanzar el siguiente', async () => {
        // La version anterior de este test encadenaba dos efectos SINCRONOS y
        // comprobaba el orden del array resultante: habria pasado igual con
        // Promise.all. Con una publicacion diferida se distingue de verdad.
        const d = dobles();
        const orden: string[] = [];
        const publicacion = diferida();
        d.mqtt.publicarEstado.mockImplementation(async () => {
            orden.push('publicar:inicio');
            await publicacion.promesa;
            orden.push('publicar:fin');
        });
        d.jitsi.crear.mockImplementation(() => orden.push('crear'));

        const lote = d.interprete.ejecutar([
            { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId: 'c1' },
            { tipo: 'crear-jitsi', sala: 's' }
        ]);

        await tics();
        expect(orden).toEqual(['publicar:inicio']);

        publicacion.resolver();
        await lote;
        expect(orden).toEqual(['publicar:inicio', 'publicar:fin', 'crear']);
    });

    it('un lote lento no puede ser adelantado por el siguiente', async () => {
        // Este es el fallo real: el lote de `aceptar` se atasca en una publicacion
        // QoS 1, el usuario cuelga, `destruir-jitsi` corre con api === null y no
        // hace nada, y al desatascarse la publicacion el lote viejo sigue y CREA el
        // iframe con la maquina ya en inactivo. Un iframe que nadie destruira jamas.
        const d = dobles();
        const orden: string[] = [];
        const publicacion = diferida();
        d.mqtt.publicarEstado.mockImplementation(async () => { await publicacion.promesa; });
        d.jitsi.crear.mockImplementation(() => orden.push('crear'));
        d.jitsi.destruir.mockImplementation(() => orden.push('destruir'));

        const primero = d.interprete.ejecutar([
            { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId: 'c1' },
            { tipo: 'crear-jitsi', sala: 's' }
        ]);
        const segundo = d.interprete.ejecutar([{ tipo: 'destruir-jitsi' }]);

        await tics();
        expect(orden).toEqual([]); // El segundo lote NO ha adelantado al primero.

        publicacion.resolver();
        await Promise.all([primero, segundo]);
        expect(orden).toEqual(['crear', 'destruir']);
    });

    it('enReposo espera a que se vacie la cola entera', async () => {
        const d = dobles();
        const publicacion = diferida();
        d.mqtt.publicarEstado.mockImplementation(async () => { await publicacion.promesa; });

        void d.interprete.ejecutar([{ tipo: 'publicar-estado', disponibilidad: 'libre', callId: null }]);
        void d.interprete.ejecutar([{ tipo: 'destruir-jitsi' }]);

        let listo = false;
        const espera = d.interprete.enReposo().then(() => { listo = true; });
        await tics();
        expect(listo).toBe(false);

        publicacion.resolver();
        await espera;
        expect(d.jitsi.destruir).toHaveBeenCalledTimes(1);
    });

    it('una variante de efecto sin implementar falla a gritos, no en silencio', async () => {
        const d = dobles();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        // Simula el futuro: alguien anade una variante a Efecto y olvida el case.
        // Se casteta a proposito porque el compilador ya no lo permite (default: never).
        await d.interprete.ejecutar([{ tipo: 'efecto-del-futuro' } as unknown as Efecto]);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('un fallo al publicar no impide ejecutar el resto de efectos', async () => {
        const d = dobles();
        d.mqtt.publicarEstado.mockRejectedValueOnce(new Error('broker caido'));
        await d.interprete.ejecutar([
            { tipo: 'publicar-estado', disponibilidad: 'libre', callId: null },
            { tipo: 'destruir-jitsi' }
        ]);
        expect(d.jitsi.destruir).toHaveBeenCalledTimes(1);
    });
});

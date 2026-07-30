import { describe, it, expect, vi } from 'vitest';
import { Interprete } from './interprete';
import type { Efecto } from '../core/tipos';

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

    it('ejecuta los efectos en orden', async () => {
        const d = dobles();
        const orden: string[] = [];
        d.sonidos.pararRingback.mockImplementation(() => orden.push('parar'));
        d.jitsi.crear.mockImplementation(() => orden.push('crear'));
        await d.interprete.ejecutar([
            { tipo: 'parar-ringback' },
            { tipo: 'crear-jitsi', sala: 's' }
        ]);
        expect(orden).toEqual(['parar', 'crear']);
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

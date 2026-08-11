import { describe, it, expect } from 'vitest';
import type { Estado } from '../core/tipos';
import { MS_RECARGA_PREVENTIVA, RecargaPreventiva } from './recarga-preventiva';

/** Banco de pruebas con reloj monotono falso. */
function banco(estadoInicial: Estado = 'inactivo') {
    let t = 0;
    let estado: Estado = estadoInicial;
    let recargas = 0;
    const recarga = new RecargaPreventiva({
        estado: () => estado,
        recargar: () => { recargas++; },
        ahora: () => t
    });
    return {
        recarga,
        avanzar: (ms: number) => { t += ms; },
        situar: (e: Estado) => { estado = e; },
        recargas: () => recargas
    };
}

describe('recarga preventiva', () => {
    it('no recarga antes de las 6 h aunque este en reposo', () => {
        const b = banco();
        b.avanzar(MS_RECARGA_PREVENTIVA - 1);
        b.recarga.comprobar();
        expect(b.recargas()).toBe(0);
    });

    it('recarga al cumplirse las 6 h estando en reposo', () => {
        const b = banco();
        b.avanzar(MS_RECARGA_PREVENTIVA);
        b.recarga.comprobar();
        expect(b.recargas()).toBe(1);
    });

    it('NO recarga en mitad de una llamada, por mucho que haya vencido', () => {
        // Una recarga aqui seria un cuelgue autoinfligido: mata el iframe y deja
        // a la otra sede sola en la sala.
        const b = banco('en-llamada');
        b.avanzar(MS_RECARGA_PREVENTIVA * 4);
        b.recarga.comprobar();
        expect(b.recargas()).toBe(0);
    });

    it('espera y recarga en cuanto la llamada termina', () => {
        const b = banco('en-llamada');
        b.avanzar(MS_RECARGA_PREVENTIVA + 60_000);
        b.recarga.comprobar();
        expect(b.recargas()).toBe(0);

        b.situar('inactivo');
        b.recarga.comprobar();
        expect(b.recargas()).toBe(1);
    });

    it('tampoco recarga sonando ni finalizando', () => {
        const ocupados: Estado[] = ['llamando', 'recibiendo', 'finalizando'];
        for (const estado of ocupados) {
            const b = banco(estado);
            b.avanzar(MS_RECARGA_PREVENTIVA * 2);
            b.recarga.comprobar();
            expect(b.recargas(), estado).toBe(0);
        }
    });

    it('si recarga estando sin-conexion: ahi no hay nada que interrumpir', () => {
        // Y es justo el caso en que rearrancar el cliente MQTT y su backoff puede
        // ayudar. Excluirlo dejaria sin recargar nunca al totem mas necesitado.
        const b = banco('sin-conexion');
        b.avanzar(MS_RECARGA_PREVENTIVA);
        b.recarga.comprobar();
        expect(b.recargas()).toBe(1);
    });

    it('recarga UNA sola vez aunque se sondee muchas veces despues', () => {
        const b = banco();
        b.avanzar(MS_RECARGA_PREVENTIVA);
        for (let i = 0; i < 10; i++) {
            b.recarga.comprobar();
            b.avanzar(60_000);
        }
        expect(b.recargas()).toBe(1);
    });
});

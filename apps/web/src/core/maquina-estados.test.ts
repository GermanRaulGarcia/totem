import { describe, it, expect } from 'vitest';
import { contextoInicial, transicion } from './maquina-estados';

describe('maquina de estados: arranque y conexion', () => {
    it('arranca en estado arrancando', () => {
        expect(contextoInicial().estado).toBe('arrancando');
    });

    it('pasa a inactivo cuando el broker conecta', () => {
        const r = transicion(contextoInicial(), { tipo: 'broker-conectado' });
        expect(r.contexto.estado).toBe('inactivo');
    });

    it('publica disponibilidad libre al quedar inactivo', () => {
        const r = transicion(contextoInicial(), { tipo: 'broker-conectado' });
        expect(r.efectos).toContainEqual({
            tipo: 'publicar-estado', disponibilidad: 'libre', callId: null
        });
    });

    it('pasa a sin-conexion si el broker cae', () => {
        const conectado = transicion(contextoInicial(), { tipo: 'broker-conectado' }).contexto;
        const r = transicion(conectado, { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('sin-conexion');
    });

    it('vuelve al estado seguro al reconectar', () => {
        const conectado = transicion(contextoInicial(), { tipo: 'broker-conectado' }).contexto;
        const caido = transicion(conectado, { tipo: 'broker-desconectado' }).contexto;
        const r = transicion(caido, { tipo: 'broker-conectado' });
        expect(r.contexto.estado).toBe('inactivo');
    });

    it('no muta el contexto recibido', () => {
        const ctx = contextoInicial();
        const copia = structuredClone(ctx);
        transicion(ctx, { tipo: 'broker-conectado' });
        expect(ctx).toEqual(copia);
    });

    it('ignora eventos no contemplados en el estado actual', () => {
        const ctx = contextoInicial();
        const r = transicion(ctx, { tipo: 'colgar' });
        expect(r.contexto).toEqual(ctx);
        expect(r.efectos).toEqual([]);
    });
});

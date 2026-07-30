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

import { contextoEn } from './maquina-estados';

describe('maquina de estados: llamada saliente', () => {
    const inactivo = () => contextoEn('inactivo');

    it('el toque de pantalla abre el selector', () => {
        const r = transicion(inactivo(), { tipo: 'toque-pantalla' });
        expect(r.contexto.estado).toBe('seleccionando');
    });

    it('arranca el temporizador de inactividad al abrir el selector', () => {
        const r = transicion(inactivo(), { tipo: 'toque-pantalla' });
        expect(r.efectos).toContainEqual({
            tipo: 'arrancar-timer', nombre: 'seleccion', ms: 30_000
        });
    });

    it('el timeout del selector devuelve a inactivo', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'timeout-seleccion' });
        expect(r.contexto.estado).toBe('inactivo');
    });

    it('confirmar la seleccion publica las invitaciones', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia', 'canarias'] });
        expect(r.contexto.estado).toBe('llamando');
        const inv = r.efectos.find(e => e.tipo === 'publicar-invitaciones');
        expect(inv).toBeDefined();
        expect(inv).toMatchObject({ destinos: ['murcia', 'canarias'] });
    });

    it('NO crea el iframe de Jitsi mientras esta llamando', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        expect(r.efectos.some(e => e.tipo === 'crear-jitsi')).toBe(false);
    });

    it('suena el ringback y arranca el timeout de 45 s al llamar', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        expect(r.efectos).toContainEqual({ tipo: 'sonar-ringback' });
        expect(r.efectos).toContainEqual({
            tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: 45_000
        });
    });

    it('la primera aceptacion pasa a en-llamada y crea el iframe', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia'] }).contexto;
        const r = transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.efectos).toContainEqual({ tipo: 'crear-jitsi', sala: llamando.sala! });
    });

    it('una segunda aceptacion no vuelve a crear el iframe', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia', 'canarias'] }).contexto;
        const enLlamada = transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' }).contexto;
        const r = transicion(enLlamada, { tipo: 'sede-acepto', sede: 'canarias' });
        expect(r.efectos.some(e => e.tipo === 'crear-jitsi')).toBe(false);
        expect(r.contexto.aceptadas).toEqual(['murcia', 'canarias']);
    });

    it('sin respuesta devuelve a inactivo y para el ringback', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia'] }).contexto;
        const r = transicion(llamando, { tipo: 'sin-respuesta' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({ tipo: 'parar-ringback' });
    });
});

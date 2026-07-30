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

import type { Invitacion, Evento } from './tipos';

const invitacionDe = (origen: string): Invitacion => ({
    callId: 'call-1',
    sala: 'spm-call-1',
    origen,
    invitados: ['lorca'],
    ts: '2026-07-30T10:00:00Z'
});

describe('maquina de estados: llamada entrante', () => {
    it('una invitacion estando inactivo pasa a recibiendo', () => {
        const r = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        });
        expect(r.contexto.estado).toBe('recibiendo');
        expect(r.contexto.origen).toBe('murcia');
    });

    it('suena el timbre al recibir', () => {
        const r = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        });
        expect(r.efectos).toContainEqual({ tipo: 'sonar-timbre' });
    });

    it('NO crea el iframe mientras suena', () => {
        const r = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        });
        expect(r.efectos.some(e => e.tipo === 'crear-jitsi')).toBe(false);
    });

    it('aceptar crea el iframe y publica la aceptacion', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const r = transicion(rec, { tipo: 'aceptar' });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.efectos).toContainEqual({ tipo: 'crear-jitsi', sala: 'spm-call-1' });
        expect(r.efectos).toContainEqual({
            tipo: 'publicar-evento-llamada', callId: 'call-1', evento: 'acepta'
        });
        expect(r.efectos).toContainEqual({ tipo: 'parar-timbre' });
    });

    it('rechazar vuelve a inactivo y lo publica', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const r = transicion(rec, { tipo: 'rechazar' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({
            tipo: 'publicar-evento-llamada', callId: 'call-1', evento: 'rechaza'
        });
    });

    it('sin respuesta registra la llamada perdida', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const r = transicion(rec, { tipo: 'sin-respuesta' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({ tipo: 'registrar-perdida', origen: 'murcia' });
    });

    it('una invitacion durante en-llamada NO cambia de estado', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const enLlamada = transicion(rec, { tipo: 'aceptar' }).contexto;
        const r = transicion(enLlamada, {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('canarias')
        });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.contexto.callId).toBe('call-1');
        expect(r.efectos.some(e => e.tipo === 'crear-jitsi')).toBe(false);
        expect(r.efectos.some(e => e.tipo === 'destruir-jitsi')).toBe(false);
    });
});

describe('maquina de estados: colgar y el invariante del iframe', () => {
    const llegarAEnLlamada = () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destinos: ['murcia'] }).contexto;
        return transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' }).contexto;
    };

    it('colgar pasa a finalizando y destruye el iframe', () => {
        const r = transicion(llegarAEnLlamada(), { tipo: 'colgar' });
        expect(r.contexto.estado).toBe('finalizando');
        expect(r.efectos).toContainEqual({ tipo: 'destruir-jitsi' });
    });

    it('finalizando vuelve a inactivo al completar el teardown', () => {
        const fin = transicion(llegarAEnLlamada(), { tipo: 'colgar' }).contexto;
        const r = transicion(fin, { tipo: 'teardown-completo' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.contexto.callId).toBeNull();
        expect(r.contexto.sala).toBeNull();
    });

    it('un fallo de Jitsi tambien destruye el iframe', () => {
        const r = transicion(llegarAEnLlamada(), { tipo: 'jitsi-fallo' });
        expect(r.contexto.estado).toBe('finalizando');
        expect(r.efectos).toContainEqual({ tipo: 'destruir-jitsi' });
    });

    it('INVARIANTE: cada crear-jitsi termina con exactamente un destruir-jitsi', () => {
        const secuencia: Evento[] = [
            { tipo: 'broker-conectado' },
            { tipo: 'toque-pantalla' },
            { tipo: 'seleccion-confirmada', destinos: ['murcia'] },
            { tipo: 'sede-acepto', sede: 'murcia' },
            { tipo: 'colgar' },
            { tipo: 'teardown-completo' }
        ];
        let ctx = contextoInicial();
        let creados = 0;
        let destruidos = 0;
        for (const ev of secuencia) {
            const r = transicion(ctx, ev);
            ctx = r.contexto;
            creados += r.efectos.filter(e => e.tipo === 'crear-jitsi').length;
            destruidos += r.efectos.filter(e => e.tipo === 'destruir-jitsi').length;
        }
        expect(creados).toBe(1);
        expect(destruidos).toBe(1);
        expect(ctx.estado).toBe('inactivo');
    });

    it('INVARIANTE: una llamada no contestada nunca crea iframe', () => {
        const secuencia: Evento[] = [
            { tipo: 'broker-conectado' },
            { tipo: 'toque-pantalla' },
            { tipo: 'seleccion-confirmada', destinos: ['murcia'] },
            { tipo: 'sin-respuesta' }
        ];
        let ctx = contextoInicial();
        let creados = 0;
        for (const ev of secuencia) {
            const r = transicion(ctx, ev);
            ctx = r.contexto;
            creados += r.efectos.filter(e => e.tipo === 'crear-jitsi').length;
        }
        expect(creados).toBe(0);
        expect(ctx.estado).toBe('inactivo');
    });
});

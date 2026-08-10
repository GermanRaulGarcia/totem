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

    it('al reconectar se vuelve SIEMPRE a inactivo', () => {
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

    it('confirmar la seleccion publica UNA invitacion al unico destino', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' });
        expect(r.contexto.estado).toBe('llamando');
        expect(r.contexto.destino).toBe('murcia');
        const invitaciones = r.efectos.filter(e => e.tipo === 'publicar-invitacion');
        expect(invitaciones).toHaveLength(1);
        expect(invitaciones[0]).toMatchObject({ destino: 'murcia', sala: r.contexto.sala! });
    });

    it('NO crea el iframe de Jitsi mientras esta llamando', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' });
        expect(r.efectos.some(e => e.tipo === 'crear-jitsi')).toBe(false);
    });

    it('suena el ringback y arranca el timeout de 45 s al llamar', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' });
        expect(r.efectos).toContainEqual({ tipo: 'sonar-ringback' });
        expect(r.efectos).toContainEqual({
            tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: 45_000
        });
    });

    it('la aceptacion del destino pasa a en-llamada y crea el iframe', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        const r = transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.contexto.par).toBe('murcia');
        expect(r.efectos).toContainEqual({ tipo: 'crear-jitsi', sala: llamando.sala! });
    });

    it('una aceptacion de una sede que NO es el destino no entra en la llamada', () => {
        // Con llamadas 1 a 1 esto seria colar a un tercero. El filtro por callId de
        // `totem.ts` no lo cubre: una sede podria publicar sobre nuestro callId.
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        const r = transicion(llamando, { tipo: 'sede-acepto', sede: 'canarias' });
        expect(r.contexto).toBe(llamando);
        expect(r.efectos).toEqual([]);
    });

    it('sin respuesta devuelve a inactivo y para el ringback', () => {
        const sel = transicion(inactivo(), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        const r = transicion(llamando, { tipo: 'sin-respuesta' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.contexto.destino).toBeNull();
        expect(r.efectos).toContainEqual({ tipo: 'parar-ringback' });
    });
});

import type { Invitacion, Evento } from './tipos';

const invitacionDe = (origen: string): Invitacion => ({
    callId: 'call-1',
    sala: 'spm-call-1',
    origen,
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
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
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
            { tipo: 'seleccion-confirmada', destino: 'murcia' },
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
            { tipo: 'seleccion-confirmada', destino: 'murcia' },
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

describe('maquina de estados: desacoplamiento de senalizacion y medio', () => {
    const llegarAEnLlamada = () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        return transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' }).contexto;
    };

    it('un broker caido durante en-llamada NO corta la llamada activa', () => {
        const r = transicion(llegarAEnLlamada(), { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.efectos).toEqual([]);
    });

    it('tras un broker caido en plena llamada, colgar sigue destruyendo el iframe exactamente una vez', () => {
        const caido = transicion(llegarAEnLlamada(), { tipo: 'broker-desconectado' }).contexto;
        const r = transicion(caido, { tipo: 'colgar' });
        expect(r.contexto.estado).toBe('finalizando');
        expect(r.efectos.filter(e => e.tipo === 'destruir-jitsi')).toHaveLength(1);
    });

    it('INVARIANTE: un corte de broker en plena llamada no rompe el emparejamiento crear/destruir', () => {
        const secuencia: Evento[] = [
            { tipo: 'broker-conectado' },
            { tipo: 'toque-pantalla' },
            { tipo: 'seleccion-confirmada', destino: 'murcia' },
            { tipo: 'sede-acepto', sede: 'murcia' },
            { tipo: 'broker-desconectado' },
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

    it('un broker caido estando inactivo si pasa a sin-conexion (sin regresion)', () => {
        const r = transicion(contextoEn('inactivo'), { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('sin-conexion');
    });

    it('al volver el broker en plena llamada se republica OCUPADO, nunca libre', () => {
        // El reverso de la excepcion de §3.2. Si la llamada sobrevive a la caida,
        // el reenganche tiene que contar la verdad. Antes lo publicaba la capa
        // MQTT con `('libre', null)` fijo, y el retenido se quedaba mintiendo el
        // resto de la llamada: otra sede veia el totem disponible y lo llamaba.
        const enLlamada = llegarAEnLlamada();
        const caido = transicion(enLlamada, { tipo: 'broker-desconectado' }).contexto;
        const r = transicion(caido, { tipo: 'broker-conectado' });

        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.efectos).toEqual([
            { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId: enLlamada.callId }
        ]);
    });

    it('al volver el broker estando en reposo se republica libre', () => {
        // El broker puede haber rearrancado con la persistencia vacia: si nadie
        // republica, la sede se queda sin estado retenido para las demas.
        const r = transicion(contextoEn('inactivo'), { tipo: 'broker-conectado' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({
            tipo: 'publicar-estado', disponibilidad: 'libre', callId: null
        });
    });
});

describe('maquina de estados: el otro lado cuelga', () => {
    const llegarAEnLlamada = () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        return transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' }).contexto;
    };

    it('si cuelga el par se pasa a finalizando', () => {
        const r = transicion(llegarAEnLlamada(), { tipo: 'sede-colgo', sede: 'murcia' });
        expect(r.contexto.estado).toBe('finalizando');
        expect(r.contexto.par).toBeNull();
        expect(r.efectos).toContainEqual({ tipo: 'destruir-jitsi' });
    });

    it('un cuelgue de una sede que no estaba en la llamada se ignora', () => {
        const ctx = llegarAEnLlamada();
        const r = transicion(ctx, { tipo: 'sede-colgo', sede: 'desconocida' });
        expect(r.contexto).toBe(ctx);
        expect(r.efectos).toEqual([]);
    });

    it('INVARIANTE: una llamada que cuelga el OTRO lado deja cero iframes vivos', () => {
        // El fallo fundacional del sistema antiguo: quedarse solo en una sala para
        // siempre. El diseno lo cubre en §5.2 ("Colgar, o se queda solo").
        const secuencia: Evento[] = [
            { tipo: 'broker-conectado' },
            { tipo: 'toque-pantalla' },
            { tipo: 'seleccion-confirmada', destino: 'murcia' },
            { tipo: 'sede-acepto', sede: 'murcia' },
            { tipo: 'sede-colgo', sede: 'murcia' },
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

    it('si el origen cuelga mientras suena, el timbre para y vuelve a inactivo', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const r = transicion(rec, { tipo: 'sede-colgo', sede: 'murcia' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({ tipo: 'parar-timbre' });
        expect(r.efectos).toContainEqual({ tipo: 'registrar-perdida', origen: 'murcia' });
    });
});

describe('maquina de estados: respuesta del unico destino', () => {
    // Este bloque sustituye al antiguo "estado por sede durante la llamada
    // saliente". Con llamadas 1 a 1 (negocio, 2026-07-31) ya no hay un mapa de
    // estados por sede: cualquier respuesta del destino resuelve la llamada
    // entera, en el acto y en un solo sentido.
    const llamandoA = (destino: string) => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        return transicion(sel, { tipo: 'seleccion-confirmada', destino }).contexto;
    };

    it('un rechazo acaba la llamada de inmediato, sin agotar los 45 s', () => {
        const ctx = llamandoA('murcia');
        const r = transicion(ctx, { tipo: 'sede-rechazo', sede: 'murcia' });
        expect(r.contexto.estado).toBe('inactivo');
        expect(r.efectos).toContainEqual({ tipo: 'parar-ringback' });
        expect(r.efectos).toContainEqual({ tipo: 'cancelar-timer', nombre: 'sin-respuesta' });
    });

    it('un sin-respuesta remoto se comporta igual que un rechazo', () => {
        const ctx = llamandoA('murcia');
        const r = transicion(ctx, { tipo: 'sede-sin-respuesta', sede: 'murcia' });
        expect(r.contexto.estado).toBe('inactivo');
    });

    it('una respuesta de una sede que no es el destino se ignora', () => {
        const ctx = llamandoA('murcia');
        const r = transicion(ctx, { tipo: 'sede-rechazo', sede: 'canarias' });
        expect(r.contexto).toBe(ctx);
        expect(r.efectos).toEqual([]);
    });

    it('durante la llamada, los eventos de una TERCERA sede no alteran nada', () => {
        // Nadie se incorpora a una llamada en curso. Un evento ajeno que consiga
        // pasar el filtro por callId no puede tocar ni el estado ni los efectos.
        const enLlamada = transicion(
            llamandoA('murcia'), { tipo: 'sede-acepto', sede: 'murcia' }
        ).contexto;
        for (const ajeno of ['sede-acepto', 'sede-rechazo', 'sede-sin-respuesta', 'sede-colgo'] as const) {
            const r = transicion(enLlamada, { tipo: ajeno, sede: 'canarias' });
            expect(r.contexto).toBe(enLlamada);
            expect(r.efectos).toEqual([]);
        }
    });

    it('un segundo acepta del propio par tampoco reabre nada', () => {
        // Reentrega del broker: no puede volver a crear el iframe.
        const enLlamada = transicion(
            llamandoA('murcia'), { tipo: 'sede-acepto', sede: 'murcia' }
        ).contexto;
        const r = transicion(enLlamada, { tipo: 'sede-acepto', sede: 'murcia' });
        expect(r.contexto).toBe(enLlamada);
        expect(r.efectos).toEqual([]);
    });
});

describe('maquina de estados: timeout de union a Jitsi', () => {
    const enLlamada = () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const llamando = transicion(sel, { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;
        return transicion(llamando, { tipo: 'sede-acepto', sede: 'murcia' });
    };

    it('al entrar en llamada arranca el temporizador de 15 s (diseno §5.4)', () => {
        expect(enLlamada().efectos).toContainEqual({
            tipo: 'arrancar-timer', nombre: 'union-jitsi', ms: 15_000
        });
    });

    it('crear-jitsi va ANTES que cualquier publicacion al aceptar', () => {
        const rec = transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const efectos = transicion(rec, { tipo: 'aceptar' }).efectos;
        const iCrear = efectos.findIndex(e => e.tipo === 'crear-jitsi');
        const iPublicar = efectos.findIndex(e => e.tipo.startsWith('publicar-'));
        expect(iCrear).toBeGreaterThanOrEqual(0);
        expect(iPublicar).toBeGreaterThan(iCrear);
    });

    it('unirse cancela el temporizador', () => {
        const ctx = enLlamada().contexto;
        const r = transicion(ctx, { tipo: 'jitsi-unido' });
        expect(r.efectos).toEqual([{ tipo: 'cancelar-timer', nombre: 'union-jitsi' }]);
        expect(r.contexto.estado).toBe('en-llamada');
    });

    it('salir de la llamada cancela el temporizador de union', () => {
        const ctx = enLlamada().contexto;
        const r = transicion(ctx, { tipo: 'colgar' });
        expect(r.efectos).toContainEqual({ tipo: 'cancelar-timer', nombre: 'union-jitsi' });
    });
});

describe('maquina de estados: invitacion durante el selector', () => {
    it('la invitacion expulsa al selector y pasa a recibiendo', () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const r = transicion(sel, {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        });
        expect(r.contexto.estado).toBe('recibiendo');
        expect(r.contexto.origen).toBe('murcia');
        expect(r.efectos).toContainEqual({ tipo: 'cancelar-timer', nombre: 'seleccion' });
        expect(r.efectos).toContainEqual({ tipo: 'sonar-timbre' });
        expect(r.efectos).toContainEqual({
            tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: 45_000
        });
    });

    it('y desde ahi se puede aceptar con normalidad', () => {
        const sel = transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;
        const rec = transicion(sel, {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;
        const r = transicion(rec, { tipo: 'aceptar' });
        expect(r.contexto.estado).toBe('en-llamada');
        expect(r.efectos).toContainEqual({ tipo: 'crear-jitsi', sala: 'spm-call-1' });
    });
});

describe('maquina de estados: el broker cae con algo sonando', () => {
    const seleccionando = () =>
        transicion(contextoEn('inactivo'), { tipo: 'toque-pantalla' }).contexto;

    const llamando = () =>
        transicion(seleccionando(), { tipo: 'seleccion-confirmada', destino: 'murcia' }).contexto;

    const recibiendo = () =>
        transicion(contextoEn('inactivo'), {
            tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia')
        }).contexto;

    it('desde recibiendo para el timbre y cancela el temporizador de 45 s', () => {
        // El fallo que arregla esto: `sin-conexion` se alcanzaba con `efectos: []`,
        // asi que el `setInterval` del timbre seguia sonando cada 1,5 s para
        // siempre y solo se recuperaba recargando el kiosco.
        const r = transicion(recibiendo(), { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('sin-conexion');
        expect(r.efectos).toEqual([
            { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
            { tipo: 'parar-timbre' }
        ]);
    });

    it('desde llamando para el ringback y cancela el temporizador de 45 s', () => {
        const r = transicion(llamando(), { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('sin-conexion');
        expect(r.efectos).toEqual([
            { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
            { tipo: 'parar-ringback' }
        ]);
    });

    it('desde seleccionando cancela el temporizador de inactividad', () => {
        const r = transicion(seleccionando(), { tipo: 'broker-desconectado' });
        expect(r.contexto.estado).toBe('sin-conexion');
        expect(r.efectos).toEqual([{ tipo: 'cancelar-timer', nombre: 'seleccion' }]);
    });

    it('no publica nada por MQTT: el broker es justo lo que se ha caido', () => {
        for (const ctx of [seleccionando(), llamando(), recibiendo()]) {
            const r = transicion(ctx, { tipo: 'broker-desconectado' });
            expect(r.efectos.filter(e => e.tipo.startsWith('publicar-'))).toEqual([]);
        }
    });

    it('desde inactivo y arrancando no hay nada que apagar', () => {
        for (const ctx of [contextoEn('inactivo'), contextoInicial()]) {
            expect(transicion(ctx, { tipo: 'broker-desconectado' }).efectos).toEqual([]);
        }
    });

    it('INVARIANTE: ningun sonido arrancado sobrevive a la vuelta a inactivo', () => {
        // Recorre las dos vias que dejan un bucle sonando y comprueba el
        // emparejamiento sonar/parar de punta a punta, incluido el reenganche.
        const vias: Evento[][] = [
            [
                { tipo: 'invitacion-recibida', invitacion: invitacionDe('murcia') },
                { tipo: 'broker-desconectado' },
                { tipo: 'broker-conectado' }
            ],
            [
                { tipo: 'toque-pantalla' },
                { tipo: 'seleccion-confirmada', destino: 'murcia' },
                { tipo: 'broker-desconectado' },
                { tipo: 'broker-conectado' }
            ]
        ];
        for (const via of vias) {
            let ctx = contextoEn('inactivo');
            let sonando = 0;
            let timers = 0;
            for (const ev of via) {
                const r = transicion(ctx, ev);
                ctx = r.contexto;
                for (const efecto of r.efectos) {
                    if (efecto.tipo === 'sonar-timbre' || efecto.tipo === 'sonar-ringback') sonando++;
                    if (efecto.tipo === 'parar-timbre' || efecto.tipo === 'parar-ringback') sonando--;
                    if (efecto.tipo === 'arrancar-timer') timers++;
                    if (efecto.tipo === 'cancelar-timer') timers--;
                }
            }
            expect(ctx.estado).toBe('inactivo');
            expect(sonando).toBe(0);
            expect(timers).toBe(0);
        }
    });
});

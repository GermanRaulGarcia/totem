import {
    MS_TIMEOUT_SELECCION,
    MS_TIMEOUT_SIN_RESPUESTA,
    type Contexto, type Efecto, type Estado, type Evento, type Resultado
} from './tipos';

export function contextoInicial(): Contexto {
    return {
        estado: 'arrancando',
        estadoSeguro: 'inactivo',
        callId: null,
        sala: null,
        origen: null,
        destinos: [],
        aceptadas: []
    };
}

/** Solo para tests: construye un contexto ya situado en un estado concreto. */
export function contextoEn(estado: Estado): Contexto {
    return { ...contextoInicial(), estado, estadoSeguro: estado };
}

/** Inyectable para que los tests y el E2E puedan fijar el identificador. */
export let generarCallId: () => string = () => crypto.randomUUID();

export function fijarGeneradorCallId(fn: () => string): void {
    generarCallId = fn;
}

function sinCambios(ctx: Contexto): Resultado {
    return { contexto: ctx, efectos: [] };
}

function irAInactivo(ctx: Contexto, efectosPrevios: Efecto[] = []): Resultado {
    return {
        contexto: {
            ...ctx,
            estado: 'inactivo',
            estadoSeguro: 'inactivo',
            callId: null,
            sala: null,
            origen: null,
            destinos: [],
            aceptadas: []
        },
        efectos: [
            ...efectosPrevios,
            { tipo: 'publicar-estado', disponibilidad: 'libre', callId: null }
        ]
    };
}

export function transicion(ctx: Contexto, evento: Evento): Resultado {
    if (evento.tipo === 'broker-desconectado' && ctx.estado !== 'sin-conexion') {
        return { contexto: { ...ctx, estado: 'sin-conexion' }, efectos: [] };
    }

    switch (ctx.estado) {
        case 'arrancando':
        case 'sin-conexion':
            if (evento.tipo === 'broker-conectado') return irAInactivo(ctx);
            return sinCambios(ctx);

        case 'inactivo':
            if (evento.tipo === 'toque-pantalla') {
                return {
                    contexto: { ...ctx, estado: 'seleccionando' },
                    efectos: [{ tipo: 'arrancar-timer', nombre: 'seleccion', ms: MS_TIMEOUT_SELECCION }]
                };
            }
            return sinCambios(ctx);

        case 'seleccionando': {
            if (evento.tipo === 'timeout-seleccion' || evento.tipo === 'cancelar') {
                return irAInactivo(ctx, [{ tipo: 'cancelar-timer', nombre: 'seleccion' }]);
            }
            if (evento.tipo === 'seleccion-confirmada') {
                const callId = generarCallId();
                const sala = `spm-${callId}`;
                return {
                    contexto: {
                        ...ctx,
                        estado: 'llamando',
                        callId,
                        sala,
                        destinos: evento.destinos,
                        aceptadas: []
                    },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'seleccion' },
                        { tipo: 'publicar-invitaciones', callId, sala, destinos: evento.destinos },
                        { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId },
                        { tipo: 'sonar-ringback' },
                        { tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: MS_TIMEOUT_SIN_RESPUESTA }
                    ]
                };
            }
            return sinCambios(ctx);
        }

        case 'llamando': {
            if (evento.tipo === 'sede-acepto') {
                return {
                    contexto: { ...ctx, estado: 'en-llamada', aceptadas: [evento.sede] },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                        { tipo: 'parar-ringback' },
                        { tipo: 'crear-jitsi', sala: ctx.sala! }
                    ]
                };
            }
            if (evento.tipo === 'sin-respuesta' || evento.tipo === 'cancelar') {
                return irAInactivo(ctx, [
                    { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                    { tipo: 'parar-ringback' },
                    { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'cuelga' }
                ]);
            }
            return sinCambios(ctx);
        }

        case 'en-llamada': {
            if (evento.tipo === 'sede-acepto') {
                if (ctx.aceptadas.includes(evento.sede)) return sinCambios(ctx);
                return {
                    contexto: { ...ctx, aceptadas: [...ctx.aceptadas, evento.sede] },
                    efectos: []
                };
            }
            return sinCambios(ctx);
        }

        default:
            return sinCambios(ctx);
    }
}

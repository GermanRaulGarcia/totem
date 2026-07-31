import {
    MS_TIMEOUT_SELECCION,
    MS_TIMEOUT_SIN_RESPUESTA,
    MS_TIMEOUT_UNION_JITSI,
    type Contexto, type Efecto, type Estado, type EstadoDestino, type Evento, type Resultado
} from './tipos';

export function contextoInicial(): Contexto {
    return {
        estado: 'arrancando',
        estadoSeguro: 'inactivo',
        callId: null,
        sala: null,
        origen: null,
        destinos: [],
        aceptadas: [],
        estadosDestino: {}
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
            aceptadas: [],
            estadosDestino: {}
        },
        efectos: [
            ...efectosPrevios,
            { tipo: 'publicar-estado', disponibilidad: 'libre', callId: null }
        ]
    };
}

/**
 * Salida de `en-llamada`. Unico punto que emite `destruir-jitsi`. Cancela ademas
 * el temporizador de union: si el timeout de 15 s sobreviviera a la llamada,
 * dispararia un `jitsi-fallo` sobre una llamada que ya no existe.
 */
function irAFinalizando(ctx: Contexto, parcial: Partial<Contexto> = {}): Resultado {
    return {
        contexto: { ...ctx, ...parcial, estado: 'finalizando' },
        efectos: [
            { tipo: 'cancelar-timer', nombre: 'union-jitsi' },
            { tipo: 'destruir-jitsi' },
            { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'cuelga' }
        ]
    };
}

/**
 * Entrada a `en-llamada`. El orden importa y no es cosmetico: `crear-jitsi` va
 * ANTES que las publicaciones MQTT porque el interprete ejecuta los efectos en
 * serie y espera a cada publicacion. Si un publish QoS 1 se atasca con el broker
 * medio caido (situacion que §3.2 permite deliberadamente sin salir de la
 * llamada), dejar `crear-jitsi` al final mantendria la llamada muda hasta que el
 * broker respondiera. Entrar a la sala importa mas que anunciarlo.
 */
function efectosEntrarEnLlamada(sala: string): Efecto[] {
    return [
        { tipo: 'crear-jitsi', sala },
        { tipo: 'arrancar-timer', nombre: 'union-jitsi', ms: MS_TIMEOUT_UNION_JITSI }
    ];
}

/** Marca el estado de una sede invitada sin mutar el contexto recibido. */
function marcar(
    ctx: Contexto, sede: string, estado: EstadoDestino
): Record<string, EstadoDestino> {
    return { ...ctx.estadosDestino, [sede]: estado };
}

export function transicion(ctx: Contexto, evento: Evento): Resultado {
    // Excepcion deliberada: durante 'en-llamada' o 'finalizando' NO se corta a sin-conexion
    // al caer el broker. Principio de desacoplamiento (diseno §3.2): la senalizacion viaja
    // por MQTT pero el medio viaja por Jitsi, asi que perder el broker solo pierde presencia,
    // nunca la llamada activa. No "simplificar" quitando esta guarda.
    if (
        evento.tipo === 'broker-desconectado' &&
        ctx.estado !== 'sin-conexion' &&
        ctx.estado !== 'en-llamada' &&
        ctx.estado !== 'finalizando'
    ) {
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
            if (evento.tipo === 'invitacion-recibida') {
                const { callId, sala, origen } = evento.invitacion;
                return {
                    contexto: { ...ctx, estado: 'recibiendo', callId, sala, origen },
                    efectos: [
                        { tipo: 'sonar-timbre' },
                        { tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: MS_TIMEOUT_SIN_RESPUESTA }
                    ]
                };
            }
            return sinCambios(ctx);

        case 'seleccionando': {
            if (evento.tipo === 'timeout-seleccion' || evento.tipo === 'cancelar') {
                return irAInactivo(ctx, [{ tipo: 'cancelar-timer', nombre: 'seleccion' }]);
            }
            // Decision: una invitacion entrante EXPULSA al selector, no se encola.
            // Motivo: al otro lado hay una persona esperando en tiempo real con un
            // temporizador de 45 s corriendo, mientras que el selector es por
            // definicion una intencion sin confirmar y sin nadie esperando. Encolarla
            // haria que el llamante agotase los 45 s en silencio y que el timbre
            // sonara despues, para una llamada que ya no existe: el peor de los dos
            // mundos. Un telefono que suena interrumpe lo que estabas marcando.
            if (evento.tipo === 'invitacion-recibida') {
                const { callId, sala, origen } = evento.invitacion;
                return {
                    contexto: { ...ctx, estado: 'recibiendo', callId, sala, origen },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'seleccion' },
                        { tipo: 'sonar-timbre' },
                        { tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: MS_TIMEOUT_SIN_RESPUESTA }
                    ]
                };
            }
            if (evento.tipo === 'seleccion-confirmada') {
                const callId = generarCallId();
                const sala = `spm-${callId}`;
                const estadosDestino: Record<string, EstadoDestino> = {};
                for (const destino of evento.destinos) estadosDestino[destino] = 'sonando';
                return {
                    contexto: {
                        ...ctx,
                        estado: 'llamando',
                        callId,
                        sala,
                        destinos: evento.destinos,
                        aceptadas: [],
                        estadosDestino
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
                    contexto: {
                        ...ctx,
                        estado: 'en-llamada',
                        aceptadas: [evento.sede],
                        estadosDestino: marcar(ctx, evento.sede, 'acepto')
                    },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                        { tipo: 'parar-ringback' },
                        ...efectosEntrarEnLlamada(ctx.sala!)
                    ]
                };
            }
            // Una sede que rechaza o no contesta deja de sonar. Si TODAS han
            // contestado que no, la llamada se acaba ya: sin esto, el llamante
            // seguia oyendo el ringback los 45 s completos tras un rechazo inmediato.
            if (evento.tipo === 'sede-rechazo' || evento.tipo === 'sede-sin-respuesta') {
                if (!ctx.destinos.includes(evento.sede)) return sinCambios(ctx);
                const estadosDestino = marcar(
                    ctx, evento.sede,
                    evento.tipo === 'sede-rechazo' ? 'rechazo' : 'sin-respuesta'
                );
                const sigueSonandoAlguna = ctx.destinos.some(d => estadosDestino[d] === 'sonando');
                if (sigueSonandoAlguna) {
                    return { contexto: { ...ctx, estadosDestino }, efectos: [] };
                }
                return irAInactivo({ ...ctx, estadosDestino }, [
                    { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                    { tipo: 'parar-ringback' },
                    { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'cuelga' }
                ]);
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

        case 'recibiendo': {
            const comunes: Efecto[] = [
                { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                { tipo: 'parar-timbre' }
            ];
            if (evento.tipo === 'aceptar') {
                return {
                    contexto: {
                        ...ctx,
                        estado: 'en-llamada',
                        aceptadas: [ctx.origen!],
                        estadosDestino: marcar(ctx, ctx.origen!, 'acepto')
                    },
                    efectos: [
                        ...comunes,
                        ...efectosEntrarEnLlamada(ctx.sala!),
                        { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'acepta' },
                        { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId: ctx.callId }
                    ]
                };
            }
            if (evento.tipo === 'rechazar') {
                return irAInactivo(ctx, [
                    ...comunes,
                    { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'rechaza' }
                ]);
            }
            if (evento.tipo === 'sin-respuesta') {
                return irAInactivo(ctx, [
                    ...comunes,
                    { tipo: 'publicar-evento-llamada', callId: ctx.callId!, evento: 'sin-respuesta' },
                    { tipo: 'registrar-perdida', origen: ctx.origen! }
                ]);
            }
            // El origen se arrepiente antes de que contestemos: el timbre para.
            if (evento.tipo === 'sede-colgo' && evento.sede === ctx.origen) {
                return irAInactivo(ctx, [
                    ...comunes,
                    { tipo: 'registrar-perdida', origen: ctx.origen }
                ]);
            }
            return sinCambios(ctx);
        }

        case 'en-llamada': {
            if (evento.tipo === 'sede-acepto') {
                if (ctx.aceptadas.includes(evento.sede)) return sinCambios(ctx);
                return {
                    contexto: {
                        ...ctx,
                        aceptadas: [...ctx.aceptadas, evento.sede],
                        estadosDestino: marcar(ctx, evento.sede, 'acepto')
                    },
                    efectos: []
                };
            }
            if (evento.tipo === 'sede-rechazo' || evento.tipo === 'sede-sin-respuesta') {
                if (!ctx.destinos.includes(evento.sede)) return sinCambios(ctx);
                return {
                    contexto: {
                        ...ctx,
                        estadosDestino: marcar(
                            ctx, evento.sede,
                            evento.tipo === 'sede-rechazo' ? 'rechazo' : 'sin-respuesta'
                        )
                    },
                    efectos: []
                };
            }
            // Diseno §5.2: se sale de `en-llamada` al colgar "o se queda solo".
            // Esta es la segunda mitad: si el ultimo acompañante cuelga, esta sede
            // se queda sola en la sala. Sin esto el iframe sobrevive a la llamada
            // en una sala vacia para siempre, que es exactamente el fallo del
            // sistema antiguo que este proyecto existe para eliminar.
            if (evento.tipo === 'sede-colgo') {
                if (!ctx.aceptadas.includes(evento.sede)) return sinCambios(ctx);
                const aceptadas = ctx.aceptadas.filter(s => s !== evento.sede);
                const estadosDestino = marcar(ctx, evento.sede, 'colgo');
                if (aceptadas.length > 0) {
                    return { contexto: { ...ctx, aceptadas, estadosDestino }, efectos: [] };
                }
                return irAFinalizando(ctx, { aceptadas, estadosDestino });
            }
            if (evento.tipo === 'jitsi-unido') {
                return {
                    contexto: ctx,
                    efectos: [{ tipo: 'cancelar-timer', nombre: 'union-jitsi' }]
                };
            }
            if (evento.tipo === 'colgar' || evento.tipo === 'jitsi-fallo') {
                return irAFinalizando(ctx);
            }
            return sinCambios(ctx);
        }

        case 'finalizando':
            if (evento.tipo === 'teardown-completo') return irAInactivo(ctx);
            return sinCambios(ctx);

        default:
            return sinCambios(ctx);
    }
}

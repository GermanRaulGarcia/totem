import {
    MS_TIMEOUT_SELECCION,
    MS_TIMEOUT_SIN_RESPUESTA,
    MS_TIMEOUT_UNION_JITSI,
    type Contexto, type Efecto, type Estado, type Evento, type Resultado
} from './tipos';

export function contextoInicial(): Contexto {
    return {
        estado: 'arrancando',
        callId: null,
        sala: null,
        origen: null,
        destino: null,
        par: null
    };
}

/** Solo para tests: construye un contexto ya situado en un estado concreto. */
export function contextoEn(estado: Estado): Contexto {
    return { ...contextoInicial(), estado };
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
            callId: null,
            sala: null,
            origen: null,
            destino: null,
            par: null
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

/**
 * Lo que hay que apagar al entrar en `sin-conexion` desde cada estado.
 *
 * `sin-conexion` es transversal (diseno §5.3.2), pero llegar a el NO es gratis:
 * se entra desde `seleccionando` con un temporizador armado, y desde `llamando`
 * o `recibiendo` con un temporizador de 45 s Y un sonido en BUCLE. Devolver
 * `efectos: []` dejaba el `setInterval` del timbre sonando cada 1,5-2,5 s para
 * siempre -recuperable solo recargando un kiosco desatendido- y el temporizador
 * vivo, disparando despues contra `inactivo`, que lo ignora en silencio.
 *
 * Aqui NO se publica nada por MQTT: el broker es justo lo que acaba de caerse.
 * La presencia la arregla el `broker-conectado` del reenganche, que vuelve a
 * `inactivo` y publica `libre`.
 */
function efectosAlPerderElBroker(estado: Estado): Efecto[] {
    switch (estado) {
        case 'seleccionando':
            return [{ tipo: 'cancelar-timer', nombre: 'seleccion' }];
        case 'llamando':
            return [
                { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                { tipo: 'parar-ringback' }
            ];
        case 'recibiendo':
            return [
                { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                { tipo: 'parar-timbre' }
            ];
        default:
            return [];
    }
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
        return {
            contexto: { ...ctx, estado: 'sin-conexion' },
            efectos: efectosAlPerderElBroker(ctx.estado)
        };
    }

    switch (ctx.estado) {
        case 'arrancando':
        case 'sin-conexion':
            if (evento.tipo === 'broker-conectado') return irAInactivo(ctx);
            return sinCambios(ctx);

        case 'inactivo':
            // Un CONNACK estando en reposo republica la presencia. Normalmente se
            // llega aqui desde `sin-conexion`, pero el broker puede haber
            // rearrancado con la persistencia vacia sin que la maquina llegara a
            // enterarse; sin esta rama la sede quedaria sin estado retenido, es
            // decir invisible o congelada en el ultimo valor que vieron las demas.
            if (evento.tipo === 'broker-conectado') return irAInactivo(ctx);
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
            // Un destino, no una lista: negocio retiro la llamada multi-sede el
            // 2026-07-31. La eleccion de A QUE sede se llama se mantiene intacta.
            if (evento.tipo === 'seleccion-confirmada') {
                const callId = generarCallId();
                const sala = `spm-${callId}`;
                return {
                    contexto: {
                        ...ctx,
                        estado: 'llamando',
                        callId,
                        sala,
                        destino: evento.destino,
                        par: null
                    },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'seleccion' },
                        { tipo: 'publicar-invitacion', callId, sala, destino: evento.destino },
                        { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId },
                        { tipo: 'sonar-ringback' },
                        { tipo: 'arrancar-timer', nombre: 'sin-respuesta', ms: MS_TIMEOUT_SIN_RESPUESTA }
                    ]
                };
            }
            return sinCambios(ctx);
        }

        case 'llamando': {
            // Solo el destino de ESTA llamada puede contestarla. El filtro por
            // callId de `totem.ts` ya descarta las llamadas ajenas, pero eso no
            // cubre a una sede que publique sobre nuestro callId sin haber sido
            // invitada: con llamadas 1 a 1 eso seria colar a un tercero.
            if (evento.tipo === 'sede-acepto') {
                if (evento.sede !== ctx.destino) return sinCambios(ctx);
                return {
                    contexto: { ...ctx, estado: 'en-llamada', par: evento.sede },
                    efectos: [
                        { tipo: 'cancelar-timer', nombre: 'sin-respuesta' },
                        { tipo: 'parar-ringback' },
                        ...efectosEntrarEnLlamada(ctx.sala!)
                    ]
                };
            }
            // Si el unico destino dice que no, la llamada se acaba ya: sin esto el
            // llamante seguia oyendo el ringback los 45 s completos tras un
            // rechazo inmediato.
            if (evento.tipo === 'sede-rechazo' || evento.tipo === 'sede-sin-respuesta') {
                if (evento.sede !== ctx.destino) return sinCambios(ctx);
                return irAInactivo(ctx, [
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
                    contexto: { ...ctx, estado: 'en-llamada', par: ctx.origen },
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
            // El reverso de la excepcion de §3.2. La llamada sobrevive a la caida
            // del broker, asi que cuando el broker vuelve hay que contarle la
            // verdad: esta sede sigue OCUPADA en `callId`. Antes el reenganche lo
            // hacia la capa MQTT publicando `libre` a ciegas en cada CONNACK, y el
            // estado retenido se quedaba mintiendo el resto de la llamada: las
            // demas sedes veian un totem disponible y lo llamaban a 45 s de
            // silencio. La disponibilidad la conoce la maquina, no el transporte.
            if (evento.tipo === 'broker-conectado') {
                return {
                    contexto: ctx,
                    efectos: [
                        { tipo: 'publicar-estado', disponibilidad: 'ocupado', callId: ctx.callId }
                    ]
                };
            }
            // Aqui NO se contemplan `sede-acepto`, `sede-rechazo` ni
            // `sede-sin-respuesta`. Con llamadas 1 a 1 solo hay un invitado y ya
            // ha contestado: cualquier otra respuesta es un duplicado del broker o
            // una sede que no pinta nada en esta llamada. En ambos casos, no hacer
            // nada es la respuesta correcta.

            // Diseno §5.2: se sale de `en-llamada` al colgar "o se queda solo".
            // Esta es la segunda mitad: si el par cuelga, esta sede se queda sola
            // en la sala. Sin esto el iframe sobrevive a la llamada en una sala
            // vacia para siempre, que es exactamente el fallo del sistema antiguo
            // que este proyecto existe para eliminar.
            if (evento.tipo === 'sede-colgo') {
                if (evento.sede !== ctx.par) return sinCambios(ctx);
                return irAFinalizando(ctx, { par: null });
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
            // `finalizando` tambien sobrevive a la caida del broker, pero NO
            // republica nada al reconectar: `destruir-jitsi` es sincrono y
            // `teardown-completo` se emite pase lo que pase, asi que este estado
            // dura milisegundos y `irAInactivo` publicara `libre` acto seguido.
            // Publicar `ocupado` aqui solo anadiria un retenido que se pisa solo.
            if (evento.tipo === 'teardown-completo') return irAInactivo(ctx);
            return sinCambios(ctx);

        default:
            return sinCambios(ctx);
    }
}

import type { Contexto, Efecto, Evento, Resultado } from './tipos';

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

function sinCambios(ctx: Contexto): Resultado {
    return { contexto: ctx, efectos: [] };
}

function irAInactivo(ctx: Contexto): Resultado {
    const efectos: Efecto[] = [
        { tipo: 'publicar-estado', disponibilidad: 'libre', callId: null }
    ];
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
        efectos
    };
}

export function transicion(ctx: Contexto, evento: Evento): Resultado {
    // La desconexion del broker se atiende desde cualquier estado.
    if (evento.tipo === 'broker-desconectado' && ctx.estado !== 'sin-conexion') {
        return {
            contexto: { ...ctx, estado: 'sin-conexion', estadoSeguro: ctx.estadoSeguro },
            efectos: []
        };
    }

    switch (ctx.estado) {
        case 'arrancando':
            if (evento.tipo === 'broker-conectado') return irAInactivo(ctx);
            return sinCambios(ctx);

        case 'sin-conexion':
            if (evento.tipo === 'broker-conectado') return irAInactivo(ctx);
            return sinCambios(ctx);

        default:
            return sinCambios(ctx);
    }
}

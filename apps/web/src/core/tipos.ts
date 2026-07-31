export type Disponibilidad = 'libre' | 'ocupado';

export interface Sede {
    id: string;
    nombre: string;
    orden: number;
}

export interface EstadoSede {
    sede: string;
    nombre: string;
    online: boolean;
    disponibilidad: Disponibilidad;
    callId: string | null;
    ts: string;
}

export interface Invitacion {
    callId: string;
    sala: string;
    origen: string;
    invitados: string[];
    ts: string;
}

export type TipoEventoLlamada = 'acepta' | 'rechaza' | 'sin-respuesta' | 'se-une' | 'cuelga';

export interface EventoLlamada {
    callId: string;
    sede: string;
    tipo: TipoEventoLlamada;
    ts: string;
}

export type Estado =
    | 'arrancando'
    | 'inactivo'
    | 'seleccionando'
    | 'llamando'
    | 'recibiendo'
    | 'en-llamada'
    | 'finalizando'
    | 'sin-conexion';

/**
 * Estado en vivo de cada sede invitada durante una llamada saliente.
 * La pantalla `llamando` lo muestra sede por sede (diseno §6).
 */
export type EstadoDestino = 'sonando' | 'acepto' | 'rechazo' | 'sin-respuesta' | 'colgo';

export type Evento =
    | { tipo: 'broker-conectado' }
    | { tipo: 'broker-desconectado' }
    | { tipo: 'toque-pantalla' }
    | { tipo: 'seleccion-confirmada'; destinos: string[] }
    | { tipo: 'cancelar' }
    | { tipo: 'timeout-seleccion' }
    | { tipo: 'invitacion-recibida'; invitacion: Invitacion }
    | { tipo: 'aceptar' }
    | { tipo: 'rechazar' }
    | { tipo: 'sin-respuesta' }
    | { tipo: 'sede-acepto'; sede: string }
    | { tipo: 'sede-rechazo'; sede: string }
    | { tipo: 'sede-sin-respuesta'; sede: string }
    | { tipo: 'sede-colgo'; sede: string }
    | { tipo: 'colgar' }
    | { tipo: 'jitsi-unido' }
    | { tipo: 'jitsi-fallo' }
    | { tipo: 'teardown-completo' };

export type Efecto =
    | { tipo: 'publicar-invitaciones'; callId: string; sala: string; destinos: string[] }
    | { tipo: 'publicar-evento-llamada'; callId: string; evento: TipoEventoLlamada }
    | { tipo: 'publicar-estado'; disponibilidad: Disponibilidad; callId: string | null }
    | { tipo: 'crear-jitsi'; sala: string }
    | { tipo: 'destruir-jitsi' }
    | { tipo: 'sonar-timbre' }
    | { tipo: 'parar-timbre' }
    | { tipo: 'sonar-ringback' }
    | { tipo: 'parar-ringback' }
    | { tipo: 'arrancar-timer'; nombre: NombreTimer; ms: number }
    | { tipo: 'cancelar-timer'; nombre: NombreTimer }
    | { tipo: 'registrar-perdida'; origen: string };

export type NombreTimer = 'seleccion' | 'sin-respuesta' | 'union-jitsi';

export interface Contexto {
    estado: Estado;
    estadoSeguro: Estado;
    callId: string | null;
    sala: string | null;
    origen: string | null;
    destinos: string[];
    aceptadas: string[];
    /** Estado en vivo por sede invitada. Clave: id de sede. */
    estadosDestino: Record<string, EstadoDestino>;
}

export interface Resultado {
    contexto: Contexto;
    efectos: Efecto[];
}

export const MS_TIMEOUT_SELECCION = 30_000;
export const MS_TIMEOUT_SIN_RESPUESTA = 45_000;
/** Diseno §5.4: si `videoConferenceJoined` no llega en 15 s se aborta y se vuelve a reposo. */
export const MS_TIMEOUT_UNION_JITSI = 15_000;

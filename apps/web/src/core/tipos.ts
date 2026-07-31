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

/**
 * Regla de dominio: a que sede se puede llamar AHORA MISMO.
 *
 * Vive en `core` y no en la interfaz porque la comprueban tres capas -el boton
 * Llamar, el saneado de la seleccion en `Totem` y el manejador del toque- y si
 * discreparan volveria justo el defecto que este predicado cierra: una tarjeta
 * pintada como no pulsable con el boton Llamar todavia apuntandole.
 */
export function esLlamable(s: EstadoSede): boolean {
    return s.online && s.disponibilidad !== 'ocupado';
}

export interface Invitacion {
    callId: string;
    sala: string;
    origen: string;
    ts: string;
}

/**
 * Ya no existe `se-une`: las llamadas son 1 a 1 y nadie se incorpora a una
 * llamada en curso. Ver la nota del 2026-07-31 en el diseno §5.2.
 */
export type TipoEventoLlamada = 'acepta' | 'rechaza' | 'sin-respuesta' | 'cuelga';

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

export type Evento =
    | { tipo: 'broker-conectado' }
    | { tipo: 'broker-desconectado' }
    | { tipo: 'toque-pantalla' }
    | { tipo: 'seleccion-confirmada'; destino: string }
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
    | { tipo: 'publicar-invitacion'; callId: string; sala: string; destino: string }
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

/**
 * Una llamada tiene como mucho DOS sedes (negocio, 2026-07-31). Por eso aqui no
 * hay listas: hay a lo sumo un origen, un destino y un par.
 */
export interface Contexto {
    estado: Estado;
    estadoSeguro: Estado;
    callId: string | null;
    sala: string | null;
    /** Quien nos llama, mientras la llamada es entrante. */
    origen: string | null;
    /** A quien llamamos, mientras la llamada es saliente. */
    destino: string | null;
    /**
     * La otra sede YA dentro de la llamada. Distinto de `destino`: durante
     * `llamando` hay destino y todavia no hay par. Es lo que decide si un
     * `sede-colgo` nos deja solos en la sala.
     */
    par: string | null;
}

export interface Resultado {
    contexto: Contexto;
    efectos: Efecto[];
}

export const MS_TIMEOUT_SELECCION = 30_000;
export const MS_TIMEOUT_SIN_RESPUESTA = 45_000;
/** Diseno §5.4: si `videoConferenceJoined` no llega en 15 s se aborta y se vuelve a reposo. */
export const MS_TIMEOUT_UNION_JITSI = 15_000;

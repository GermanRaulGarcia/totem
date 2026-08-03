// Los comodines de MQTT ('+' y '#') y el separador de niveles ('/') cambian la
// FORMA del topic, no solo su contenido. Un id de sede con '/' convierte
// `totem/{sede}/estado` en un topic de mas niveles al que nadie esta suscrito, y
// uno con '+' o '#' produce un patron que publica o escucha donde no debe. Como
// estos identificadores llegan por red (config/sedes, invitaciones, eventos), se
// rechazan explicitamente en vez de confiar en que nadie los escriba mal.
const CARACTERES_PROHIBIDOS = ['+', '#', '/'];

function validar(valor: string, que: string): string {
    const limpio = valor.trim();
    if (limpio === '') throw new Error(`${que} vacia`);
    for (const caracter of CARACTERES_PROHIBIDOS) {
        if (limpio.includes(caracter)) {
            throw new Error(`${que} invalida: no puede contener '${caracter}'`);
        }
    }
    return limpio;
}

export function topicEstado(sede: string): string {
    return `totem/${validar(sede, 'sede')}/estado`;
}

export function topicInvitacion(sede: string): string {
    return `totem/${validar(sede, 'sede')}/invitacion`;
}

export function topicEventoLlamada(callId: string): string {
    return `llamada/${validar(callId, 'callId')}/evento`;
}

export const TOPIC_CONFIG_SEDES = 'config/sedes';
export const PATRON_ESTADOS = 'totem/+/estado';
export const PATRON_EVENTOS_LLAMADA = 'llamada/+/evento';

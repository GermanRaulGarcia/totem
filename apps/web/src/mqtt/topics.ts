function validar(sede: string): string {
    if (sede.trim() === '') throw new Error('sede vacia');
    return sede;
}

export function topicEstado(sede: string): string {
    return `totem/${validar(sede)}/estado`;
}

export function topicInvitacion(sede: string): string {
    return `totem/${validar(sede)}/invitacion`;
}

export function topicEventoLlamada(callId: string): string {
    return `llamada/${callId}/evento`;
}

export const TOPIC_CONFIG_SEDES = 'config/sedes';
export const PATRON_ESTADOS = 'totem/+/estado';

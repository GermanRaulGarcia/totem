import { describe, it, expect } from 'vitest';
import {
    topicEstado, topicInvitacion, topicEventoLlamada,
    TOPIC_CONFIG_SEDES, PATRON_ESTADOS
} from './topics';

describe('topics', () => {
    it('construye el topic de estado de una sede', () => {
        expect(topicEstado('lorca')).toBe('totem/lorca/estado');
    });

    it('construye el topic de invitacion de una sede', () => {
        expect(topicInvitacion('murcia')).toBe('totem/murcia/invitacion');
    });

    it('construye el topic de eventos de una llamada', () => {
        expect(topicEventoLlamada('abc-123')).toBe('llamada/abc-123/evento');
    });

    it('expone el topic retenido del directorio de sedes', () => {
        expect(TOPIC_CONFIG_SEDES).toBe('config/sedes');
    });

    it('expone el patron de suscripcion a todos los estados', () => {
        expect(PATRON_ESTADOS).toBe('totem/+/estado');
    });

    it('rechaza identificadores de sede vacios', () => {
        expect(() => topicEstado('')).toThrow('sede vacia');
    });

    it('rechaza una sede que solo tiene espacios', () => {
        expect(() => topicEstado('   ')).toThrow('sede vacia');
    });

    it('recorta los espacios sobrantes', () => {
        expect(topicEstado('  lorca  ')).toBe('totem/lorca/estado');
    });

    // Un id con estos caracteres cambia la FORMA del topic, no solo su contenido.
    it.each(['+', '#', '/'])('rechaza una sede que contiene %s', caracter => {
        expect(() => topicEstado(`lorca${caracter}x`)).toThrow('sede invalida');
        expect(() => topicInvitacion(`lorca${caracter}x`)).toThrow('sede invalida');
    });

    it('valida tambien el callId, que llega por red', () => {
        expect(() => topicEventoLlamada('')).toThrow('callId vacia');
        expect(() => topicEventoLlamada('c1/#')).toThrow('callId invalida');
    });
});

import { describe, it, expect } from 'vitest';
import { horaEn, horasDeSedes } from './horas';

// 2026-08-11 a las 10:00 UTC. En verano la peninsula va en UTC+2 y Canarias en
// UTC+1, asi que son las 12:00 en Lorca y las 11:00 en Las Palmas.
const VERANO = new Date('2026-08-11T10:00:00Z');
// 2026-01-15 a las 10:00 UTC. En invierno, UTC+1 y UTC+0: 11:00 y 10:00.
const INVIERNO = new Date('2026-01-15T10:00:00Z');

describe('horaEn', () => {
    it('da la hora de la zona pedida', () => {
        expect(horaEn('Europe/Madrid', VERANO)).toBe('12:00');
        expect(horaEn('Atlantic/Canary', VERANO)).toBe('11:00');
    });

    it('la diferencia con Canarias se mantiene en invierno', () => {
        // Es el motivo de usar zonas IANA y no un desfase en horas: el cambio de
        // hora lo resuelve el navegador. Con "-1" a mano habria que revisarlo dos
        // veces al año en un kiosco que nadie mira.
        expect(horaEn('Europe/Madrid', INVIERNO)).toBe('11:00');
        expect(horaEn('Atlantic/Canary', INVIERNO)).toBe('10:00');
    });

    it('sin zona no hay hora', () => {
        expect(horaEn(undefined, VERANO)).toBeNull();
        expect(horaEn('   ', VERANO)).toBeNull();
    });

    it('una zona invalida devuelve null en vez de lanzar', () => {
        // `zona` llega en config/sedes, o sea por red, y un valor mal escrito hace
        // que Intl lance RangeError. Sin capturarlo reventaria el repintado de
        // TODOS los totems, y de forma permanente: config/sedes es retenido, asi
        // que al reconectar volveria a llegar el mismo payload roto.
        expect(horaEn('Europe/Lorca', VERANO)).toBeNull();
        expect(horaEn('no es una zona', VERANO)).toBeNull();
    });
});

describe('horasDeSedes', () => {
    const sedes = [
        { sede: 'lorca', zona: 'Europe/Madrid' },
        { sede: 'canarias', zona: 'Atlantic/Canary' },
        { sede: 'murcia', zona: 'Europe/Madrid' }
    ];

    it('solo devuelve las sedes cuya hora NO coincide con la de aqui', () => {
        // Repetir la misma hora en todas las tarjetas entierra el unico dato que
        // importa. Asi la diferencia salta sin que nadie compare.
        expect(horasDeSedes(sedes, '12:00', VERANO)).toEqual({ canarias: '11:00' });
    });

    it('si el totem estuviera en Canarias, las de la peninsula son las que difieren', () => {
        expect(horasDeSedes(sedes, '11:00', VERANO)).toEqual({
            lorca: '12:00', murcia: '12:00'
        });
    });

    it('una sede sin zona simplemente no aparece', () => {
        expect(horasDeSedes([{ sede: 'nueva' }], '12:00', VERANO)).toEqual({});
    });
});

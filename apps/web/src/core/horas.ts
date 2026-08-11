/**
 * La hora local de cada sede.
 *
 * Existe por Canarias: va una hora por detras de la peninsula, asi que llamar a
 * las 9:00 desde Lorca es llamar a las 8:00 alli. Verlo en la tarjeta, antes de
 * pulsar, evita la llamada a destiempo.
 *
 * Puro y con el instante inyectado: sin `new Date()` dentro, esto se prueba con
 * una hora fija en vez de con lo que marque el reloj de quien ejecute los tests.
 */

/**
 * La hora en una zona IANA, o `null` si la zona falta o no vale.
 *
 * El `try` no es defensivo por costumbre: `zona` llega en `config/sedes`, es
 * decir por red, y un valor mal escrito hace que `Intl` lance `RangeError`. Sin
 * capturarlo, un directorio con una errata reventaria el repintado de TODOS los
 * totems a la vez, y ademas de forma permanente, porque `config/sedes` es un
 * mensaje retenido: al reconectar volveria a llegar el mismo payload roto.
 */
export function horaEn(zona: string | undefined, ahora: Date): string | null {
    if (zona === undefined || zona.trim() === '') return null;
    try {
        return new Intl.DateTimeFormat('es-ES', {
            hour: '2-digit', minute: '2-digit', timeZone: zona
        }).format(ahora);
    } catch {
        return null;
    }
}

/**
 * Que sedes tienen que enseñar su hora: solo aquellas en las que NO es la misma
 * que aqui.
 *
 * Repetir "10:14" en todas las tarjetas cuando el reloj grande ya dice 10:14 es
 * ruido, y ademas entierra el unico dato que importa. Enseñandola solo cuando
 * difiere, la diferencia salta a la vista sin que nadie tenga que comparar.
 */
export function horasDeSedes(
    sedes: readonly { sede: string; zona?: string }[],
    horaPropia: string,
    ahora: Date
): Record<string, string> {
    const horas: Record<string, string> = {};
    for (const s of sedes) {
        const hora = horaEn(s.zona, ahora);
        if (hora !== null && hora !== horaPropia) horas[s.sede] = hora;
    }
    return horas;
}

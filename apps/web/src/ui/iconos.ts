/**
 * Iconos SVG en linea.
 *
 * En linea y no como fichero, ni como fuente de iconos, ni desde un CDN: el
 * diseno prohibe que el arranque del totem dependa de que responda nada externo,
 * y un icono que no carga en un panel de pared deja un boton mudo que nadie sabe
 * interpretar. Aqui viajan dentro del bundle y no pueden faltar.
 *
 * Todos usan `currentColor`, asi que heredan el color del boton y no hay que
 * mantener una variante por estado. Y todos son trazo sobre `viewBox` 24x24, que
 * es lo que les da el mismo peso visual estando dibujados a distinta escala.
 */

const ATRIBUTOS =
    // Trazo de 2: a 24 de viewBox es el grosor que sigue leyendose cuando el
    // icono se pinta a 56 px en un panel que se mira desde dos metros.
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

function svg(contenido: string): string {
    return `<svg class="icono" ${ATRIBUTOS}>${contenido}</svg>`;
}

/** Capsula, arco y pie: el microfono de toda la vida. */
const MICROFONO = `
    <rect x="9" y="2.5" width="6" height="11" rx="3"/>
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0"/>
    <path d="M12 17.5V21"/>`;

/** Cuerpo rectangular y el prisma del objetivo. */
const CAMARA = `
    <rect x="2.5" y="7" width="13" height="10" rx="2.5"/>
    <path d="M15.5 11.2 21.5 8v8l-6-3.2z"/>`;

/** Auricular en L. Rotado 135 grados es el gesto universal de colgar. */
const AURICULAR = `
    <path d="M6.6 3.6a2 2 0 0 1 2.8 0l1.6 1.6a2 2 0 0 1 0 2.9L9.7 9.4a12.5 12.5 0
             0 0 4.9 4.9l1.3-1.3a2 2 0 0 1 2.9 0l1.6 1.6a2 2 0 0 1 0 2.8l-1 1c-1.2
             1.2-3.1 1.4-4.6.5A24.5 24.5 0 0 1 5.1 9.2c-.9-1.5-.7-3.4.5-4.6z"/>`;

/** Barra diagonal para las variantes "apagado" y "rechazar". */
const TACHADO = `<path d="M3.5 3.5 20.5 20.5"/>`;

/** Sede caida: el circulo tachado, la marca universal de "no disponible". */
const DESCONECTADO = `<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>`;

export const ICONOS = {
    micro: svg(MICROFONO),
    microApagado: svg(MICROFONO + TACHADO),
    camara: svg(CAMARA),
    camaraApagada: svg(CAMARA + TACHADO),
    llamar: svg(AURICULAR),
    aceptar: svg(AURICULAR),
    // El auricular girado: no hace falta un segundo dibujo, y asi colgar y
    // descolgar se leen como el mismo objeto en dos posiciones.
    colgar: `<svg class="icono icono--colgar" ${ATRIBUTOS}>${AURICULAR}</svg>`,
    rechazar: `<svg class="icono icono--colgar" ${ATRIBUTOS}>${AURICULAR}</svg>`,
    cancelar: svg(`<path d="M5.5 5.5 18.5 18.5"/><path d="M18.5 5.5 5.5 18.5"/>`),
    desconectado: svg(DESCONECTADO)
} as const;

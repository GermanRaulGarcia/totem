import { esLlamable, type Contexto, type Estado, type EstadoSede } from '../core/tipos';

/**
 * Que significa un toque sobre el DOM que pinta este modulo.
 *
 * Vive aqui, junto al marcado, y no en `main.ts`, porque enrutar es una
 * propiedad de la estructura del DOM: quien decide que atributos lleva cada
 * nodo tiene que ser tambien quien declare como se leen. Ademas asi es una
 * funcion pura y se puede afirmar el ENRUTADO en un test en vez de afirmar
 * atributos sueltos y confiar en que `main.ts` los interprete como se espera.
 */
export type Toque =
    | { tipo: 'accion'; accion: string }
    | { tipo: 'sede'; sede: string };

/** Selector unico de delegacion de eventos. */
const SELECTOR_TOQUE = '[data-accion], [data-sede]';

export function enrutarToque(objetivo: EventTarget | null, estado: Estado): Toque | null {
    const nodo = objetivo instanceof Element
        ? objetivo.closest<HTMLElement>(SELECTOR_TOQUE)
        : null;
    if (nodo === null) return null;

    // `data-sede` solo significa "elegir sede" mientras el selector esta abierto.
    // En reposo la misma tarjeta lleva tambien `data-accion="despertar"` y es esa
    // la lectura correcta.
    const sede = nodo.dataset.sede;
    if (sede !== undefined && estado === 'seleccionando') return { tipo: 'sede', sede };

    const accion = nodo.dataset.accion;
    return accion === undefined ? null : { tipo: 'accion', accion };
}

export interface Vista {
    contexto: Contexto;
    sedes: EstadoSede[];
    /** A lo sumo una sede elegida: las llamadas son 1 a 1. */
    seleccion: string | null;
    reloj: string;
    microSilenciado: boolean;
    camaraApagada: boolean;
}

function claseSede(s: EstadoSede): string {
    if (!s.online) return 'sede sede--offline';
    return s.disponibilidad === 'ocupado' ? 'sede sede--ocupada' : 'sede sede--libre';
}

// `EstadoSede.nombre` y `Contexto.origen` llegan por MQTT (topic retenido
// config/sedes y payloads de invitacion publicados por otros totems): son
// texto de red sin validar, no constantes del propio codigo. Sin escapar,
// una sede con credenciales validas podria inyectar HTML/JS en la pantalla
// de todos los demas totems, que son kiosks desatendidos con permisos de
// camara y microfono ya concedidos.
// Exportada solo para poder fijar el contrato en un test: al leer innerHTML,
// jsdom (y los navegadores) vuelven a serializar `&#39;` como `'`, asi que desde
// el DOM es imposible distinguir "escapado" de "no escapado".
export function escapar(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        // Tambien la comilla simple: hoy todos los atributos de estas plantillas
        // usan comillas dobles, pero eso es una propiedad del codigo actual, no una
        // garantia. Un solo atributo escrito con comillas simples reabriria el
        // agujero sin que nada avisara.
        .replace(/'/g, '&#39;');
}

/** Nombre legible de una sede a partir de su id, con el id como ultimo recurso. */
function nombreDe(v: Vista, id: string): string {
    return v.sedes.find(s => s.sede === id)?.nombre ?? id;
}

/**
 * ¿Se puede pulsar Llamar? No basta con que haya una sede elegida: la presencia
 * llega por MQTT en cualquier momento, tambien con el selector abierto y el
 * usuario dudando delante del panel. Sin revalidar aqui, la tarjeta de la sede
 * elegida se pintaba gris y deshabilitada mientras el boton Llamar seguia
 * habilitado apuntandole, y la llamada salia hacia un totem que ya no podia
 * contestarla: 45 s de "Sonando..." para nadie. El selector tiene 30 s de
 * margen, asi que la ventana no es teorica.
 */
function destinoPulsable(v: Vista): boolean {
    if (v.seleccion === null) return false;
    const elegida = v.sedes.find(s => s.sede === v.seleccion);
    return elegida !== undefined && esLlamable(elegida);
}

function tarjetas(v: Vista, seleccionable: boolean): string {
    return v.sedes.map(s => {
        // En modo no seleccionable NO se usa `disabled`: un boton deshabilitado no
        // dispara click y ademas se traga el que iba dirigido a su contenedor, asi
        // que en reposo las tarjetas de sede (el objetivo mas grande y evidente de
        // la pantalla) anulaban el "Toca para llamar" justo al pulsarlas.
        //
        // La tarjeta inerte lleva ademas `data-accion="despertar"`, el mismo de la
        // seccion. El `pointer-events: none` de `.sede--inerte` ya hacia que el
        // toque atravesara, pero eso dejaba la correccion entera en manos de la
        // hoja de estilos: si el CSS no cargara, el objetivo mas grande de la
        // pantalla volveria a tragarse el toque. Con el atributo, el enrutado
        // funciona por estructura del DOM y el CSS solo es defensa en profundidad.
        const inerte = !seleccionable;
        // Una sede OCUPADA no es pulsable, igual que una offline. Con llamadas 1 a
        // 1 esta es la proteccion principal contra un tercero: nadie se incorpora
        // a una llamada en curso, asi que llamar a quien ya esta hablando solo
        // produciria 45 s de timbre que nadie va a contestar.
        const bloqueado = seleccionable && !esLlamable(s);
        return `
        <button class="${claseSede(s)}${inerte ? ' sede--inerte' : ''}" data-sede="${escapar(s.sede)}"
                ${inerte ? 'data-accion="despertar"' : ''}
                ${bloqueado ? 'disabled' : ''}
                ${inerte || bloqueado ? 'aria-disabled="true"' : ''}
                ${v.seleccion === s.sede && !bloqueado ? 'data-elegida="si"' : ''}>
            <span class="sede__nombre">${escapar(s.nombre)}</span>
            <span class="sede__estado">${s.online
                ? (s.disponibilidad === 'ocupado' ? 'En llamada' : 'Disponible')
                : 'Sin conexion'}</span>
        </button>`;
    }).join('');
}

/**
 * Diseno §6: la pantalla `llamando` muestra a quien se esta llamando.
 *
 * Ya no hay maquina de estados por sede. Con llamadas 1 a 1, mientras esta
 * pintada esta pantalla el destino SOLO puede estar sonando: si acepta se pasa a
 * `en-llamada`, y si rechaza o no contesta se vuelve a `inactivo`. Un campo que
 * unicamente puede valer `sonando` es codigo muerto disfrazado de vivo.
 */
function destino(v: Vista): string {
    const id = v.contexto.destino;
    if (id === null) return '';
    return `
        <div class="sede sede--inerte destino" data-destino="${escapar(id)}">
            <span class="sede__nombre">${escapar(nombreDe(v, id))}</span>
            <span class="sede__estado destino__estado">Sonando...</span>
        </div>`;
}

// Firma del contenido de la pantalla de reposo. Ver el comentario en `render`.
let firmaReposo: string | null = null;

export function render(raiz: HTMLElement, v: Vista): void {
    if (v.contexto.estado !== 'inactivo') firmaReposo = null;

    // El contenedor de video se conserva entre renders: destruirlo mataria el iframe.
    if (v.contexto.estado === 'en-llamada') {
        if (raiz.querySelector('#jitsi') === null) {
            raiz.innerHTML = `
                <section class="pantalla pantalla--llamada">
                    <div id="jitsi"></div>
                    <nav class="controles">
                        <button data-accion="micro" class="control">Micro</button>
                        <button data-accion="camara" class="control">Camara</button>
                        <button data-accion="colgar" class="control control--colgar">Colgar</button>
                    </nav>
                </section>`;
        }
        // Los controles reflejan el estado REAL que reporta Jitsi, no una suposicion.
        const micro = raiz.querySelector<HTMLElement>('[data-accion="micro"]');
        if (micro !== null) {
            micro.textContent = v.microSilenciado ? 'Micro off' : 'Micro';
            micro.setAttribute('aria-pressed', String(v.microSilenciado));
            micro.classList.toggle('control--inactivo', v.microSilenciado);
        }
        const camara = raiz.querySelector<HTMLElement>('[data-accion="camara"]');
        if (camara !== null) {
            camara.textContent = v.camaraApagada ? 'Camara off' : 'Camara';
            camara.setAttribute('aria-pressed', String(v.camaraApagada));
            camara.classList.toggle('control--inactivo', v.camaraApagada);
        }
        return;
    }

    switch (v.contexto.estado) {
        case 'arrancando':
            raiz.innerHTML = `<section class="pantalla"><p class="mensaje">Iniciando...</p></section>`;
            return;

        case 'sin-conexion':
            raiz.innerHTML = `
                <section class="pantalla pantalla--error">
                    <p class="mensaje">Sin conexion con el servidor</p>
                    <p class="mensaje mensaje--secundario">Reintentando...</p>
                </section>`;
            return;

        case 'inactivo': {
            // El reloj se repinta cada segundo, pero reescribir innerHTML reiniciaria
            // la animacion `deriva` de 120 s desde el 0 % en cada repintado: la
            // prevencion de burn-in (§6.1) nunca llegaria a desplazar nada en un
            // panel encendido de forma permanente. Mientras el resto del contenido
            // no cambie, solo se toca el textContent del reloj.
            const firma = JSON.stringify(
                v.sedes.map(s => [s.sede, s.nombre, s.online, s.disponibilidad])
            );
            const marcador = raiz.querySelector<HTMLElement>('.pantalla--reposo .reloj');
            if (marcador !== null && firma === firmaReposo) {
                marcador.textContent = v.reloj;
                return;
            }
            firmaReposo = firma;
            raiz.innerHTML = `
                <section class="pantalla pantalla--reposo" data-accion="despertar">
                    <p class="reloj">${escapar(v.reloj)}</p>
                    <div class="sedes">${tarjetas(v, false)}</div>
                    <p class="invitacion">Toca para llamar</p>
                </section>`;
            return;
        }

        case 'seleccionando':
            raiz.innerHTML = `
                <section class="pantalla pantalla--seleccion">
                    <h1 class="titulo">A que sede llamas</h1>
                    <div class="sedes sedes--grandes">${tarjetas(v, true)}</div>
                    <nav class="acciones">
                        <button data-accion="cancelar" class="boton">Cancelar</button>
                        <button data-accion="llamar" class="boton boton--principal"
                                ${destinoPulsable(v) ? '' : 'disabled'}>Llamar</button>
                    </nav>
                </section>`;
            return;

        case 'llamando':
            raiz.innerHTML = `
                <section class="pantalla pantalla--llamando">
                    <h1 class="titulo">Llamando...</h1>
                    <div class="sedes">${destino(v)}</div>
                    <button data-accion="cancelar" class="boton boton--colgar">Cancelar</button>
                </section>`;
            return;

        case 'recibiendo':
            raiz.innerHTML = `
                <section class="pantalla pantalla--entrante">
                    <p class="pulso"></p>
                    <h1 class="titulo">${escapar(
                        v.contexto.origen === null
                            ? 'Sede desconocida'
                            : nombreDe(v, v.contexto.origen)
                    )}</h1>
                    <p class="mensaje">te esta llamando</p>
                    <nav class="acciones">
                        <button data-accion="rechazar" class="boton boton--colgar">Rechazar</button>
                        <button data-accion="aceptar" class="boton boton--aceptar">Aceptar</button>
                    </nav>
                </section>`;
            return;

        case 'finalizando':
            raiz.innerHTML = `<section class="pantalla"><p class="mensaje">Finalizando...</p></section>`;
            return;
    }
}

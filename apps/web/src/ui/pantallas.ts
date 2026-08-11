import { esLlamable, type Contexto, type EstadoSede } from '../core/tipos';
import { ICONOS } from './iconos';

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
    | { tipo: 'llamar'; sede: string };

/** Selector unico de delegacion de eventos. */
const SELECTOR_TOQUE = '[data-accion], [data-sede]';

/**
 * Ya no depende del estado. Antes hacia falta porque `data-sede` significaba una
 * cosa en el selector y otra en reposo; retirada la pantalla de seleccion, un
 * nodo con `data-sede` solo puede ser el boton Llamar de esa sede.
 *
 * Y `data-sede` lo lleva EL BOTON, no la tarjeta: el panel esta en una pared por
 * la que pasa gente, asi que el objetivo que lanza una llamada tiene que ser
 * deliberado. Un roce sobre la tarjeta no llama.
 */
export function enrutarToque(objetivo: EventTarget | null): Toque | null {
    const nodo = objetivo instanceof Element
        ? objetivo.closest<HTMLElement>(SELECTOR_TOQUE)
        : null;
    if (nodo === null) return null;

    const sede = nodo.dataset.sede;
    if (sede !== undefined) return { tipo: 'llamar', sede };

    const accion = nodo.dataset.accion;
    return accion === undefined ? null : { tipo: 'accion', accion };
}

export interface Vista {
    contexto: Contexto;
    sedes: EstadoSede[];
    reloj: string;
    microSilenciado: boolean;
    camaraApagada: boolean;
    /**
     * Estado del TRANSPORTE, que no es el estado de la maquina.
     *
     * Durante `en-llamada` la FSM se queda donde esta aunque el broker caiga, a
     * proposito (§3.2): el medio viaja por Jitsi. Por eso `contexto.estado` no
     * sirve para saber si hay conexion, y hace falta este dato aparte.
     */
    brokerConectado: boolean;
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

function textoEstado(s: EstadoSede): string {
    if (!s.online) return 'Sin conexion';
    return s.disponibilidad === 'ocupado' ? 'En llamada' : 'Disponible';
}

/**
 * El id de sede, restringido a lo que puede ir dentro de `url(...)` sin escapar.
 *
 * Los ids llegan por red (`config/sedes`), asi que interpolarlos en un atributo
 * `style` seria una via de inyeccion CSS. `encodeURIComponent` NO sirve aqui: deja
 * pasar comillas simples y parentesis, que es justo lo que cierra un `url('...')`.
 * Con una lista blanca, lo que se interpola no puede romper nada por construccion.
 */
const ID_PARA_URL = /^[a-z0-9_-]{1,40}$/i;

export const LOGO_GENERICO = '/marca/sedes/generica.svg';

/**
 * Logotipo de la sede.
 *
 * El respaldo NO se puede hacer con dos fondos CSS apilados: `background-image`
 * con dos URLs pinta LAS DOS, una sobre otra, y como estos iconos son de linea
 * con fondo transparente el generico se veia a traves del propio. Se intento y se
 * veian superpuestos en todas las sedes.
 *
 * Con `<img>` el respaldo es de verdad: si el fichero no existe, el navegador
 * dispara `error` y `cablearRespaldoDeLogos` cambia el `src` al generico. El
 * manejador se engancha desde JS y no como atributo `onerror`, que en una
 * plantilla de innerHTML seria una via de inyeccion.
 *
 * Es lo que sostiene la promesa del §9.2: publicas `config/sedes` y la sede nueva
 * aparece el mismo dia con un icono digno, sin esperar a que nadie dibuje nada.
 */
function distintivo(s: EstadoSede): string {
    if (!ID_PARA_URL.test(s.sede)) {
        return `<img class="sede__distintivo" src="${LOGO_GENERICO}" alt="">`;
    }
    // SVG primero por calidad -escala sin pixelarse en un panel 4K- pero se
    // admite PNG detras: obligar a vectorizar un logotipo que solo existe en
    // mapa de bits seria pedirle a operaciones una herramienta de diseno para
    // cambiar un icono.
    const [primero, ...respaldo] = [
        `/marca/sedes/${s.sede}.svg`,
        `/marca/sedes/${s.sede}.png`,
        LOGO_GENERICO
    ];
    return `<img class="sede__distintivo" src="${primero}"
                 data-respaldo="${respaldo.join(' ')}" alt="">`;
}

/**
 * Va probando los respaldos de cada logotipo conforme fallan.
 *
 * El manejador se engancha desde JS y no como atributo `onerror`: dentro de una
 * plantilla de innerHTML, eso seria una via de inyeccion. Y al agotar la lista se
 * desengancha, porque si el generico tampoco cargara, reasignar `src` con un
 * `error` pendiente es un bucle infinito en un kiosco desatendido.
 */
function cablearRespaldoDeLogos(raiz: HTMLElement): void {
    for (const img of raiz.querySelectorAll<HTMLImageElement>('img.sede__distintivo')) {
        const pendientes = (img.dataset.respaldo ?? '').split(' ').filter(u => u !== '');
        const alFallar = (): void => {
            const siguiente = pendientes.shift();
            if (siguiente === undefined) {
                img.removeEventListener('error', alFallar);
                return;
            }
            img.src = siguiente;
        };
        img.addEventListener('error', alFallar);
    }
}

/**
 * El boton de la tarjeta. Existe SIEMPRE, para que todas las tarjetas midan y se
 * lean igual; lo que cambia es si llama o solo informa.
 *
 * Cuando no se puede llamar, el boton dice POR QUE -"En llamada", "Sin conexion"-
 * y va `disabled`. Eso recupera la distincion que se pierde con el borde de color:
 * una sede ocupada vuelve en dos minutos y una caida esta muerta, y de un vistazo
 * ambas eran solo "una tarjeta sin verde".
 *
 * El `data-sede` SOLO lo lleva la variante que llama. Un boton `disabled` ya no
 * dispara click, pero no depender de eso es gratis: sin el atributo, el enrutado
 * no tiene por donde mandar una llamada a una sede que no puede contestarla.
 */
function boton(s: EstadoSede): string {
    if (esLlamable(s)) {
        return `
            <button class="sede__llamar" data-sede="${escapar(s.sede)}"
                    aria-label="Llamar a ${escapar(s.nombre)}">
                ${ICONOS.llamar}<span>Llamar</span>
            </button>`;
    }
    const icono = s.online ? ICONOS.llamar : ICONOS.desconectado;
    return `
            <button class="sede__llamar sede__llamar--inerte" disabled>
                ${icono}<span>${textoEstado(s)}</span>
            </button>`;
}

/**
 * Tarjeta de sede en reposo: logotipo, nombre y el boton.
 *
 * La tarjeta es un `div` inerte y el unico elemento pulsable es el boton Llamar.
 * Es deliberado: el panel esta colgado en una pared por la que pasa gente, y si
 * la tarjeta entera lanzara la llamada, un roce al pasar haria sonar otra
 * oficina. El gesto que llama tiene que ser un gesto dirigido.
 *
 * Una sede OCUPADA no muestra boton, igual que una offline. Con llamadas 1 a 1
 * esa es la proteccion principal contra un tercero: nadie se incorpora a una
 * conversacion en curso, asi que llamar a quien ya esta hablando solo produciria
 * 45 s de timbre que nadie va a contestar.
 */
function tarjetas(v: Vista): string {
    return v.sedes.map(s => `
        <div class="${claseSede(s)}" role="group"
             aria-label="${escapar(s.nombre)}: ${textoEstado(s)}">
            <div class="sede__cabecera">
                ${distintivo(s)}
                <span class="sede__nombre">${escapar(s.nombre)}</span>
            </div>
            ${boton(s)}
        </div>`).join('');
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
        <div class="sede destino" data-destino="${escapar(id)}">
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
                    <p class="aviso-sin-broker" hidden>Sin conexion con el servidor</p>
                    <nav class="controles">
                        <button data-accion="micro" class="control" aria-label="Microfono"></button>
                        <button data-accion="camara" class="control" aria-label="Camara"></button>
                        <button data-accion="colgar" class="control control--colgar"
                                aria-label="Colgar">${ICONOS.colgar}</button>
                    </nav>
                </section>`;
        }
        // Los controles reflejan el estado REAL que reporta Jitsi, no una suposicion.
        const micro = raiz.querySelector<HTMLElement>('[data-accion="micro"]');
        if (micro !== null) {
            micro.innerHTML = v.microSilenciado ? ICONOS.microApagado : ICONOS.micro;
            micro.setAttribute('aria-label', v.microSilenciado ? 'Activar microfono' : 'Silenciar microfono');
            micro.setAttribute('aria-pressed', String(v.microSilenciado));
            micro.classList.toggle('control--inactivo', v.microSilenciado);
        }
        const camara = raiz.querySelector<HTMLElement>('[data-accion="camara"]');
        if (camara !== null) {
            camara.innerHTML = v.camaraApagada ? ICONOS.camaraApagada : ICONOS.camara;
            camara.setAttribute('aria-label', v.camaraApagada ? 'Encender camara' : 'Apagar camara');
            camara.setAttribute('aria-pressed', String(v.camaraApagada));
            camara.classList.toggle('control--inactivo', v.camaraApagada);
        }
        // Diseno §3.2: la llamada sobrevive a la caida del broker, pero la
        // interfaz TIENE que indicarlo. Sin este aviso, un corte de senalizacion
        // es indistinguible de que no pase nada, y quien esta delante no sabe que
        // la otra sede ha dejado de verle disponible.
        // Se conmuta, no se repinta: rehacer el marcado mataria el iframe.
        const aviso = raiz.querySelector<HTMLElement>('.aviso-sin-broker');
        if (aviso !== null) aviso.hidden = v.brokerConectado;
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
                <section class="pantalla pantalla--reposo">
                    <img class="marca" src="/marca/victoria-crea.png" alt="Victoria Crea">
                    <p class="reloj">${escapar(v.reloj)}</p>
                    <div class="sedes">${tarjetas(v)}</div>
                </section>`;
            cablearRespaldoDeLogos(raiz);
            return;
        }

        case 'llamando':
            raiz.innerHTML = `
                <section class="pantalla pantalla--llamando">
                    <h1 class="titulo">Llamando...</h1>
                    <div class="sedes">${destino(v)}</div>
                    <button data-accion="cancelar" class="boton boton--colgar">
                        ${ICONOS.colgar}<span>Cancelar</span>
                    </button>
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
                        <button data-accion="rechazar" class="boton boton--colgar">
                            ${ICONOS.rechazar}<span>Rechazar</span>
                        </button>
                        <button data-accion="aceptar" class="boton boton--aceptar">
                            ${ICONOS.aceptar}<span>Aceptar</span>
                        </button>
                    </nav>
                </section>`;
            return;

        case 'finalizando':
            raiz.innerHTML = `<section class="pantalla"><p class="mensaje">Finalizando...</p></section>`;
            return;
    }
}

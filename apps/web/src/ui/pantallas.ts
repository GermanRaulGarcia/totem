import type { Contexto, EstadoSede } from '../core/tipos';

export interface Vista {
    contexto: Contexto;
    sedes: EstadoSede[];
    seleccion: string[];
    reloj: string;
}

function claseSede(s: EstadoSede): string {
    if (!s.online) return 'sede sede--offline';
    return s.disponibilidad === 'ocupado' ? 'sede sede--ocupada' : 'sede sede--libre';
}

function tarjetas(v: Vista, seleccionable: boolean): string {
    return v.sedes.map(s => `
        <button class="${claseSede(s)}" data-sede="${s.sede}"
                ${seleccionable && s.online ? '' : 'disabled'}
                ${v.seleccion.includes(s.sede) ? 'data-elegida="si"' : ''}>
            <span class="sede__nombre">${s.nombre}</span>
            <span class="sede__estado">${s.online
                ? (s.disponibilidad === 'ocupado' ? 'En llamada' : 'Disponible')
                : 'Sin conexion'}</span>
        </button>`).join('');
}

export function render(raiz: HTMLElement, v: Vista): void {
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

        case 'inactivo':
            raiz.innerHTML = `
                <section class="pantalla pantalla--reposo" data-accion="despertar">
                    <p class="reloj">${v.reloj}</p>
                    <div class="sedes">${tarjetas(v, false)}</div>
                    <p class="invitacion">Toca para llamar</p>
                </section>`;
            return;

        case 'seleccionando':
            raiz.innerHTML = `
                <section class="pantalla pantalla--seleccion">
                    <h1 class="titulo">A que sede llamas</h1>
                    <div class="sedes sedes--grandes">${tarjetas(v, true)}</div>
                    <nav class="acciones">
                        <button data-accion="cancelar" class="boton">Cancelar</button>
                        <button data-accion="llamar" class="boton boton--principal"
                                ${v.seleccion.length === 0 ? 'disabled' : ''}>Llamar</button>
                    </nav>
                </section>`;
            return;

        case 'llamando':
            raiz.innerHTML = `
                <section class="pantalla pantalla--llamando">
                    <h1 class="titulo">Llamando...</h1>
                    <div class="sedes">${tarjetas(v, false)}</div>
                    <button data-accion="cancelar" class="boton boton--colgar">Cancelar</button>
                </section>`;
            return;

        case 'recibiendo':
            raiz.innerHTML = `
                <section class="pantalla pantalla--entrante">
                    <p class="pulso"></p>
                    <h1 class="titulo">${v.contexto.origen ?? 'Sede desconocida'}</h1>
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

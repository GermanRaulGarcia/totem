// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, escapar, enrutarToque, type Vista } from './pantallas';
import { contextoEn } from '../core/maquina-estados';
import type { EstadoSede } from '../core/tipos';

const sede = (id: string, online: boolean, disp: 'libre' | 'ocupado' = 'libre'): EstadoSede => ({
    sede: id, nombre: id.toUpperCase(), online, disponibilidad: disp,
    callId: null, ts: '2026-07-30T10:00:00Z'
});

describe('pantallas', () => {
    let raiz: HTMLElement;
    beforeEach(() => { raiz = document.createElement('div'); });

    const vista = (parcial: Partial<Vista>): Vista => ({
        contexto: contextoEn('inactivo'),
        sedes: [sede('murcia', true)],
        seleccion: [],
        reloj: '10:00',
        microSilenciado: false,
        camaraApagada: false,
        ...parcial
    });

    it('en reposo muestra el reloj y la invitacion a tocar', () => {
        render(raiz, vista({}));
        expect(raiz.textContent).toContain('10:00');
        expect(raiz.textContent).toContain('Toca para llamar');
    });

    it('en reposo pinta una tarjeta por sede', () => {
        render(raiz, vista({ sedes: [sede('murcia', true), sede('canarias', false)] }));
        expect(raiz.querySelectorAll('[data-sede]')).toHaveLength(2);
    });

    it('marca las sedes offline como no seleccionables', () => {
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('canarias', false)]
        }));
        const tarjeta = raiz.querySelector<HTMLButtonElement>('[data-sede="canarias"]');
        expect(tarjeta!.disabled).toBe(true);
    });

    it('el boton de llamar esta deshabilitado sin seleccion', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando') }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(true);
    });

    it('el boton de llamar se habilita con al menos una sede', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando'), seleccion: ['murcia'] }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(false);
    });

    it('en recibiendo muestra quien llama y los dos botones', () => {
        const ctx = { ...contextoEn('recibiendo'), origen: 'murcia' };
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.querySelector('.titulo')!.textContent).toBe('MURCIA');
        expect(raiz.querySelector('[data-accion="aceptar"]')).not.toBeNull();
        expect(raiz.querySelector('[data-accion="rechazar"]')).not.toBeNull();
    });

    it('en recibiendo muestra el nombre legible, no el id de la sede', () => {
        const ctx = { ...contextoEn('recibiendo'), origen: 'canarias' };
        render(raiz, vista({
            contexto: ctx,
            sedes: [{ ...sede('canarias', true), nombre: 'Gran Canaria' }]
        }));
        expect(raiz.querySelector('.titulo')!.textContent).toBe('Gran Canaria');
    });

    it('en recibiendo cae al id si la sede es desconocida', () => {
        const ctx = { ...contextoEn('recibiendo'), origen: 'sede-nueva' };
        render(raiz, vista({ contexto: ctx, sedes: [] }));
        expect(raiz.querySelector('.titulo')!.textContent).toBe('sede-nueva');
    });

    it('en sin-conexion explica el problema en vez de quedarse en negro', () => {
        render(raiz, vista({ contexto: contextoEn('sin-conexion') }));
        expect(raiz.textContent).toContain('Sin conexion');
    });

    it('en llamando muestra el titulo y el boton de cancelar', () => {
        render(raiz, vista({ contexto: contextoEn('llamando') }));
        expect(raiz.textContent).toContain('Llamando...');
        expect(raiz.querySelector('[data-accion="cancelar"]')).not.toBeNull();
    });

    it('en llamando muestra el estado en vivo de cada sede invitada', () => {
        const ctx = {
            ...contextoEn('llamando'),
            destinos: ['murcia', 'canarias'],
            estadosDestino: { murcia: 'acepto' as const, canarias: 'rechazo' as const }
        };
        render(raiz, vista({
            contexto: ctx,
            sedes: [sede('murcia', true), { ...sede('canarias', true), nombre: 'Gran Canaria' }]
        }));
        const estados = [...raiz.querySelectorAll('[data-destino]')].map(
            n => [n.getAttribute('data-destino'), n.querySelector('.destino__estado')!.textContent]
        );
        expect(estados).toEqual([['murcia', 'Acepto'], ['canarias', 'Rechazo']]);
        expect(raiz.textContent).toContain('Gran Canaria');
    });

    it('en llamando una sede sin respuesta todavia aparece como sonando', () => {
        const ctx = { ...contextoEn('llamando'), destinos: ['murcia'], estadosDestino: {} };
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.querySelector('.destino__estado')!.textContent).toBe('Sonando...');
    });

    it('en en-llamada no pinta el contenedor de video dos veces', () => {
        const ctx = contextoEn('en-llamada');
        render(raiz, vista({ contexto: ctx }));
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.querySelectorAll('#jitsi')).toHaveLength(1);
        expect(raiz.querySelector('[data-accion="colgar"]')).not.toBeNull();
    });

    it('escapa el nombre de sede antes de insertarlo en el DOM', () => {
        const maliciosa = sede('lorca', true);
        maliciosa.nombre = '<img src=x onerror=alert(1)>';
        render(raiz, vista({ sedes: [maliciosa] }));
        expect(raiz.querySelector('img')).toBeNull();
        expect(raiz.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('el texto de red sobrevive intacto tras escaparse', () => {
        const maliciosa = sede('lorca', true);
        maliciosa.nombre = "O'Donnell & <Co>";
        render(raiz, vista({ sedes: [maliciosa] }));
        expect(raiz.querySelector('.sede__nombre')!.textContent).toBe("O'Donnell & <Co>");
    });

    it('en reposo tocar una tarjeta de sede despierta la pantalla', () => {
        // Se afirma el ENRUTADO, no los atributos: la correccion anterior dependia
        // por completo de `pointer-events: none` en el CSS, asi que si la hoja de
        // estilos no cargaba, el objetivo mas grande de la pantalla volvia a
        // tragarse el toque y este test seguia en verde.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        const tarjeta = raiz.querySelector<HTMLButtonElement>('[data-sede="murcia"]')!;
        expect(enrutarToque(tarjeta, 'inactivo')).toEqual({ tipo: 'accion', accion: 'despertar' });
        // Y sigue sin usarse `disabled`, que no dispararia click en absoluto.
        expect(tarjeta.disabled).toBe(false);
    });

    it('en reposo tocar el fondo tambien despierta la pantalla', () => {
        render(raiz, vista({}));
        const fondo = raiz.querySelector('.invitacion')!;
        expect(enrutarToque(fondo, 'inactivo')).toEqual({ tipo: 'accion', accion: 'despertar' });
    });

    it('la MISMA tarjeta, con el selector abierto, elige sede en vez de despertar', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando') }));
        const tarjeta = raiz.querySelector<HTMLButtonElement>('[data-sede="murcia"]')!;
        expect(enrutarToque(tarjeta, 'seleccionando')).toEqual({ tipo: 'sede', sede: 'murcia' });
    });

    it('un toque fuera de cualquier objetivo no enruta nada', () => {
        render(raiz, vista({}));
        expect(enrutarToque(raiz, 'inactivo')).toBeNull();
        expect(enrutarToque(null, 'inactivo')).toBeNull();
    });

    it('en reposo repintar el reloj no reconstruye el subarbol', () => {
        // Reescribir innerHTML reiniciaria la animacion anti burn-in de 120 s en
        // cada tick del reloj, que es exactamente lo que hay que evitar.
        render(raiz, vista({ reloj: '10:00' }));
        const seccion = raiz.querySelector('.pantalla--reposo');
        render(raiz, vista({ reloj: '10:01' }));
        expect(raiz.querySelector('.pantalla--reposo')).toBe(seccion);
        expect(raiz.querySelector('.reloj')!.textContent).toBe('10:01');
    });

    it('en reposo un cambio de sedes si obliga a repintar', () => {
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        const seccion = raiz.querySelector('.pantalla--reposo');
        render(raiz, vista({ sedes: [sede('murcia', true), sede('canarias', true)] }));
        expect(raiz.querySelector('.pantalla--reposo')).not.toBe(seccion);
        expect(raiz.querySelectorAll('[data-sede]')).toHaveLength(2);
    });

    it('los controles de la llamada reflejan el estado real del micro y la camara', () => {
        const ctx = contextoEn('en-llamada');
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.querySelector('[data-accion="micro"]')!.textContent).toBe('Micro');

        render(raiz, vista({ contexto: ctx, microSilenciado: true, camaraApagada: true }));
        const micro = raiz.querySelector('[data-accion="micro"]')!;
        const camara = raiz.querySelector('[data-accion="camara"]')!;
        expect(micro.textContent).toBe('Micro off');
        expect(micro.getAttribute('aria-pressed')).toBe('true');
        expect(camara.textContent).toBe('Camara off');
        // Y el contenedor de video NO se ha reconstruido por el camino.
        expect(raiz.querySelectorAll('#jitsi')).toHaveLength(1);
    });
});

describe('escapar', () => {
    // Se prueba la funcion y no el DOM porque el DOM no puede distinguirlo: al
    // leer innerHTML, jsdom y los navegadores vuelven a serializar `&#39;` como `'`.
    it('escapa los cinco caracteres peligrosos', () => {
        expect(escapar(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('escapa la comilla simple, que hoy solo es inocua por convencion', () => {
        // Todos los atributos de estas plantillas usan comillas dobles. Es una
        // propiedad del codigo de hoy, no una garantia: un solo atributo escrito
        // con comillas simples reabriria el agujero sin que nada avisara.
        expect(escapar("x' onclick='alert(1)")).toBe('x&#39; onclick=&#39;alert(1)');
    });

    it('el ampersand se escapa primero, sin doble escapado', () => {
        expect(escapar('&lt;')).toBe('&amp;lt;');
    });
});

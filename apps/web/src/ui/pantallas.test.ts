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
        seleccion: null,
        reloj: '10:00',
        microSilenciado: false,
        camaraApagada: false,
        brokerConectado: true,
        ...parcial
    });

    describe('aviso de broker caido durante la llamada', () => {
        const enLlamada = (brokerConectado: boolean): Vista =>
            vista({ contexto: contextoEn('en-llamada'), brokerConectado });

        it('no se ve mientras hay broker', () => {
            render(raiz, enLlamada(true));
            const aviso = raiz.querySelector<HTMLElement>('.aviso-sin-broker');
            expect(aviso).not.toBeNull();
            expect(aviso!.hidden).toBe(true);
        });

        it('se ve cuando el broker se ha caido', () => {
            // Diseno §3.2: la llamada sigue, pero la interfaz tiene que decir que
            // se ha perdido la presencia. Sin esto, un corte de senalizacion es
            // indistinguible de que no pase nada.
            render(raiz, enLlamada(false));
            const aviso = raiz.querySelector<HTMLElement>('.aviso-sin-broker');
            expect(aviso!.hidden).toBe(false);
            expect(aviso!.textContent).toContain('Sin conexion');
        });

        it('INVARIANTE: aparecer y desaparecer NO destruye el iframe', () => {
            // El repintado de `en-llamada` solo rehace el marcado si falta #jitsi.
            // Si el aviso se pintara repintando la seccion, cada caida y cada
            // reenganche del broker mataria el iframe A MITAD DE LLAMADA, que es
            // justo lo contrario de lo que este aviso viene a documentar.
            render(raiz, enLlamada(true));
            const contenedor = raiz.querySelector('#jitsi');
            const iframe = document.createElement('iframe');
            contenedor!.appendChild(iframe);

            render(raiz, enLlamada(false));
            render(raiz, enLlamada(true));
            render(raiz, enLlamada(false));

            expect(raiz.querySelector('#jitsi')).toBe(contenedor);
            expect(contenedor!.contains(iframe)).toBe(true);
            expect(raiz.querySelector<HTMLElement>('.aviso-sin-broker')!.hidden).toBe(false);
        });
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

    it('marca las sedes OCUPADAS como no seleccionables, igual que las offline', () => {
        // Con llamadas 1 a 1 nadie se incorpora a una conversacion en curso, asi
        // que esta es la proteccion principal contra un tercero: llamar a quien ya
        // esta hablando solo produciria 45 s de timbre que nadie va a contestar.
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('murcia', true), sede('canarias', true, 'ocupado')]
        }));
        const ocupada = raiz.querySelector<HTMLButtonElement>('[data-sede="canarias"]')!;
        const libre = raiz.querySelector<HTMLButtonElement>('[data-sede="murcia"]')!;
        expect(ocupada.disabled).toBe(true);
        expect(ocupada.getAttribute('aria-disabled')).toBe('true');
        expect(ocupada.textContent).toContain('En llamada');
        expect(libre.disabled).toBe(false);
    });

    it('el boton de llamar esta deshabilitado sin seleccion', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando') }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(true);
    });

    it('el boton de llamar se habilita con la sede elegida', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando'), seleccion: 'murcia' }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(false);
        expect(raiz.querySelectorAll('[data-elegida="si"]')).toHaveLength(1);
    });

    it('si la sede elegida pasa a OCUPADA, Llamar se deshabilita', () => {
        // El usuario elige Murcia con el selector abierto y duda. Murcia acepta
        // una llamada de Canarias. La tarjeta se pinta gris y deshabilitada, pero
        // sin revalidar el destino el boton Llamar seguia habilitado apuntandole:
        // la invitacion salia hacia un totem en `en-llamada`, que la ignora, y
        // quien llama se comia 45 s de "Sonando..." para nadie. El selector tiene
        // 30 s de margen, asi que la ventana para dudar es real.
        const antes = vista({ contexto: contextoEn('seleccionando'), seleccion: 'murcia' });
        render(raiz, antes);
        expect(raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]')!.disabled).toBe(false);

        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('murcia', true, 'ocupado')],
            seleccion: 'murcia'
        }));
        expect(raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]')!.disabled).toBe(true);
        expect(raiz.querySelector<HTMLButtonElement>('[data-sede="murcia"]')!.disabled).toBe(true);
        // Y la tarjeta no se pinta a la vez deshabilitada y elegida.
        expect(raiz.querySelector('[data-elegida="si"]')).toBeNull();
    });

    it('si la sede elegida se cae de la red, Llamar se deshabilita', () => {
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('murcia', false)],
            seleccion: 'murcia'
        }));
        expect(raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]')!.disabled).toBe(true);
        expect(raiz.querySelector('[data-elegida="si"]')).toBeNull();
    });

    it('una seleccion que ya no figura entre las sedes tampoco habilita Llamar', () => {
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [],
            seleccion: 'fantasma'
        }));
        expect(raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]')!.disabled).toBe(true);
    });

    it('solo puede haber UNA tarjeta marcada como elegida', () => {
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('murcia', true), sede('canarias', true)],
            seleccion: 'canarias'
        }));
        const elegidas = [...raiz.querySelectorAll('[data-elegida="si"]')]
            .map(n => n.getAttribute('data-sede'));
        expect(elegidas).toEqual(['canarias']);
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

    it('en llamando muestra UN unico destino, con su nombre legible', () => {
        // Sin mapa de estados por sede: mientras esta pintada esta pantalla el
        // destino solo puede estar sonando. Si aceptara se pasaria a `en-llamada`;
        // si rechazara o no contestara, a `inactivo`.
        const ctx = { ...contextoEn('llamando'), destino: 'canarias' };
        render(raiz, vista({
            contexto: ctx,
            sedes: [sede('murcia', true), { ...sede('canarias', true), nombre: 'Gran Canaria' }]
        }));
        const destinos = [...raiz.querySelectorAll('[data-destino]')].map(
            n => [n.getAttribute('data-destino'), n.querySelector('.destino__estado')!.textContent]
        );
        expect(destinos).toEqual([['canarias', 'Sonando...']]);
        expect(raiz.textContent).toContain('Gran Canaria');
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

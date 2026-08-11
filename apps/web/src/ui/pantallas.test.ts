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
        propia: { sede: 'lorca', nombre: 'Lorca' },
        reloj: '10:00',
        horas: {},
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

    it('en reposo muestra el reloj', () => {
        render(raiz, vista({}));
        expect(raiz.textContent).toContain('10:00');
    });

    it('en reposo pinta una tarjeta por sede, con su nombre', () => {
        render(raiz, vista({ sedes: [sede('murcia', true), sede('canarias', false)] }));
        const nombres = [...raiz.querySelectorAll('.sede__nombre')].map(n => n.textContent);
        expect(nombres).toEqual(['MURCIA', 'CANARIAS']);
    });

    describe('boton de la tarjeta', () => {
        it('todas las tarjetas llevan boton, para que midan y se lean igual', () => {
            render(raiz, vista({
                sedes: [sede('a1', true), sede('b2', true, 'ocupado'), sede('c3', false)]
            }));
            expect(raiz.querySelectorAll('.sede__llamar')).toHaveLength(3);
        });

        it('el de una sede caida esta desactivado y dice por que', () => {
            render(raiz, vista({ sedes: [sede('lorca', false)] }));
            const b = raiz.querySelector<HTMLButtonElement>('.sede__llamar')!;
            expect(b.disabled).toBe(true);
            expect(b.textContent).toContain('Sin conexion');
        });

        it('el de una sede ocupada distingue "En llamada" de "Sin conexion"', () => {
            // Es lo que se perdia al dejar el estado solo en el color del borde:
            // una ocupada vuelve en dos minutos y una caida esta muerta.
            render(raiz, vista({ sedes: [sede('lorca', true, 'ocupado')] }));
            const b = raiz.querySelector<HTMLButtonElement>('.sede__llamar')!;
            expect(b.disabled).toBe(true);
            expect(b.textContent).toContain('En llamada');
        });

        it('el boton inerte NO lleva data-sede: no hay por donde enrutar', () => {
            // `disabled` ya impide el click, pero no depender de eso es gratis.
            render(raiz, vista({ sedes: [sede('lorca', false)] }));
            const b = raiz.querySelector('.sede__llamar')!;
            expect(b.hasAttribute('data-sede')).toBe(false);
            expect(enrutarToque(b)).toBeNull();
        });
    });

    it('solo las sedes llamables ofrecen un boton que llama', () => {
        // Retirada la pantalla de seleccion el 2026-08-10, se llama desde la
        // tarjeta. Que el boton exista o no ES el equivalente al viejo `disabled`.
        render(raiz, vista({
            sedes: [
                sede('murcia', true),
                sede('canarias', true, 'ocupado'),
                sede('lorca', false)
            ]
        }));
        const conBoton = [...raiz.querySelectorAll('[data-sede]')]
            .map(n => n.getAttribute('data-sede'));
        expect(conBoton).toEqual(['murcia']);
    });

    it('una sede OCUPADA no se puede llamar, igual que una offline', () => {
        // Con llamadas 1 a 1 nadie se incorpora a una conversacion en curso, asi
        // que esta es la proteccion principal contra un tercero: llamar a quien ya
        // esta hablando solo produciria 45 s de timbre que nadie va a contestar.
        render(raiz, vista({ sedes: [sede('canarias', true, 'ocupado')] }));
        expect(raiz.querySelector('[data-sede="canarias"]')).toBeNull();
        expect(raiz.querySelector('.sede')!.className).toContain('sede--ocupada');
    });

    it('el boton desaparece en cuanto la sede deja de estar disponible', () => {
        // Entre repintado y dedo cabe un mensaje MQTT. La comprobacion que manda
        // es la del instante del toque (`Totem.esLlamableAhora`), pero la interfaz
        // no debe seguir ofreciendo lo que ya no se puede hacer.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        expect(raiz.querySelector('[data-sede="murcia"]')).not.toBeNull();

        render(raiz, vista({ sedes: [sede('murcia', true, 'ocupado')] }));
        expect(raiz.querySelector('[data-sede="murcia"]')).toBeNull();
    });

    describe('distintivo de sede', () => {
        // Acotado a la TARJETA: la cabecera lleva otro distintivo, el de la propia
        // sede, y sin acotar el selector cogeria ese.
        const logo = (raiz: HTMLElement) =>
            raiz.querySelector<HTMLImageElement>('.sede img.sede__distintivo')!;

        it('apunta al logotipo de esa sede, y solo a ese', () => {
            // Se intento el respaldo con dos fondos CSS apilados y estaba mal:
            // `background-image` con dos URLs pinta LAS DOS. Como los iconos son
            // de linea con fondo transparente, el generico se veia A TRAVES del
            // propio y todas las sedes salian con los dibujos superpuestos.
            render(raiz, vista({ sedes: [sede('canarias', true)] }));
            expect(logo(raiz).getAttribute('src')).toBe('/marca/sedes/canarias.svg');
            expect(raiz.querySelectorAll('.sede img.sede__distintivo')).toHaveLength(1);
        });

        it('si no hay SVG prueba el PNG, y solo despues el generico', () => {
            // Obligar a vectorizar un logotipo que solo existe en mapa de bits
            // seria pedirle a operaciones una herramienta de diseno para cambiar
            // un icono.
            render(raiz, vista({ sedes: [sede('sinlogo', true)] }));
            const img = logo(raiz);
            expect(img.getAttribute('src')).toBe('/marca/sedes/sinlogo.svg');

            img.dispatchEvent(new Event('error'));
            expect(img.getAttribute('src')).toBe('/marca/sedes/sinlogo.png');

            img.dispatchEvent(new Event('error'));
            expect(img.getAttribute('src')).toBe('/marca/sedes/generica.svg');
        });

        it('no reintenta en bucle si el generico tampoco carga', () => {
            // Reasignar `src` con un `error` pendiente es un bucle infinito, y
            // esto corre en un kiosco desatendido durante semanas.
            render(raiz, vista({ sedes: [sede('sinlogo', true)] }));
            const img = logo(raiz);
            for (let i = 0; i < 5; i++) img.dispatchEvent(new Event('error'));
            expect(img.getAttribute('src')).toBe('/marca/sedes/generica.svg');
        });

        it('va al lado del nombre, no suelto en la tarjeta', () => {
            render(raiz, vista({ sedes: [sede('murcia', true)] }));
            const cabecera = raiz.querySelector('.sede__cabecera')!;
            expect(cabecera.querySelector('.sede__distintivo')).not.toBeNull();
            expect(cabecera.querySelector('.sede__nombre')).not.toBeNull();
        });

        it('un id de sede raro no construye la ruta: va directo al generico', () => {
            // Los ids llegan por `config/sedes`, o sea por red. Meterlos en un
            // atributo sin filtrar es una via de inyeccion.
            render(raiz, vista({ sedes: [sede("x'><script>", true)] }));
            expect(logo(raiz).getAttribute('src')).toBe('/marca/sedes/generica.svg');
            expect(raiz.querySelector('script')).toBeNull();
        });
    });

    describe('estado de la sede sin texto', () => {
        // El estado lo dice el borde, no un parrafo: en un panel que se mira de
        // lejos, un color se lee de un vistazo. Pero quien no distingue el color
        // -o no ve la pantalla- necesita el dato igual, y ahi esta el aria-label.
        const etiqueta = (raiz: HTMLElement) =>
            raiz.querySelector('.sede')!.getAttribute('aria-label');

        it('no escribe el estado en pantalla', () => {
            render(raiz, vista({ sedes: [sede('murcia', true)] }));
            expect(raiz.querySelector('.sedes')!.textContent).not.toContain('Disponible');
        });

        it('pero lo conserva en el aria-label, los tres estados', () => {
            render(raiz, vista({ sedes: [sede('murcia', true)] }));
            expect(etiqueta(raiz)).toContain('Disponible');

            render(raiz, vista({ sedes: [sede('murcia', true, 'ocupado')] }));
            expect(etiqueta(raiz)).toContain('En llamada');

            render(raiz, vista({ sedes: [sede('murcia', false)] }));
            expect(etiqueta(raiz)).toContain('Sin conexion');
        });

        it('cada estado lleva su clase, que es lo que pinta el borde', () => {
            render(raiz, vista({
                sedes: [sede('a1', true), sede('b2', true, 'ocupado'), sede('c3', false)]
            }));
            const clases = [...raiz.querySelectorAll('.sede')].map(n => n.className);
            expect(clases[0]).toContain('sede--libre');
            expect(clases[1]).toContain('sede--ocupada');
            expect(clases[2]).toContain('sede--offline');
        });
    });

    describe('identidad del propio totem', () => {
        it('en reposo dice de que sede es, con su logotipo', () => {
            render(raiz, vista({ propia: { sede: 'canarias', nombre: 'Gran Canaria' } }));
            const cabecera = raiz.querySelector('.identidad')!;
            expect(cabecera.textContent).toContain('Gran Canaria');
            expect(
                cabecera.querySelector<HTMLImageElement>('.identidad__sede img')!.getAttribute('src')
            ).toBe('/marca/sedes/canarias.svg');
        });

        it('la propia sede NO aparece ademas entre las tarjetas llamables', () => {
            // `Totem.sedes()` ya la excluye; esto fija que la cabecera no la
            // reintroduce por la puerta de atras. Nadie se llama a si mismo.
            render(raiz, vista({
                propia: { sede: 'lorca', nombre: 'Lorca' },
                sedes: [sede('murcia', true)]
            }));
            expect(raiz.querySelector('[data-sede="lorca"]')).toBeNull();
        });
    });

    describe('hora local de la sede', () => {
        it('se pinta en la tarjeta de la sede que la trae', () => {
            render(raiz, vista({
                sedes: [sede('canarias', true)],
                horas: { canarias: '09:00' }
            }));
            expect(raiz.querySelector('.sede__hora')!.textContent).toBe('09:00');
        });

        it('no se pinta en las sedes que no la traen', () => {
            // `horasDeSedes` solo incluye las que difieren de la hora de aqui, asi
            // que la tarjeta no decide nada: pinta lo que le llega o no pinta nada.
            render(raiz, vista({
                sedes: [sede('lorca', true), sede('canarias', true)],
                horas: { canarias: '09:00' }
            }));
            const conHora = [...raiz.querySelectorAll('.sede')]
                .filter(n => n.querySelector('.sede__hora') !== null)
                .map(n => n.querySelector('.sede__nombre')!.textContent);
            expect(conHora).toEqual(['CANARIAS']);
        });

        it('un cambio de hora repinta la pantalla de reposo', () => {
            // El atajo de reposo solo refresca el reloj grande mientras la firma no
            // cambie. Sin la hora dentro de la firma, la de la sede se quedaria
            // congelada en el minuto en que se pinto por primera vez.
            render(raiz, vista({ sedes: [sede('canarias', true)], horas: { canarias: '09:00' } }));
            render(raiz, vista({ sedes: [sede('canarias', true)], horas: { canarias: '09:01' } }));
            expect(raiz.querySelector('.sede__hora')!.textContent).toBe('09:01');
        });
    });

    it('la tarjeta NO es pulsable: solo lo es su boton', () => {
        // El panel esta en una pared por la que pasa gente. Si la tarjeta entera
        // lanzara la llamada, un roce al pasar haria sonar otra oficina.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        const tarjeta = raiz.querySelector('.sede')!;
        expect(tarjeta.hasAttribute('data-sede')).toBe(false);
        expect(tarjeta.hasAttribute('data-accion')).toBe(false);
        expect(tarjeta.querySelector('[data-sede="murcia"]')).not.toBeNull();
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
        // La pantalla de reposo tiene <img> legitimas -la marca y el logotipo de
        // cada sede-, asi que no vale con exigir que no haya ninguna. Lo que se
        // exige es que TODAS salgan de rutas nuestras y que ninguna traiga un
        // manejador: el payload inyectado seria un `<img src=x onerror=...>`.
        for (const img of raiz.querySelectorAll('img')) {
            expect(img.getAttribute('src')).toMatch(/^\/marca\//);
        }
        expect(raiz.querySelector('[onerror]')).toBeNull();
        expect(raiz.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('el texto de red sobrevive intacto tras escaparse', () => {
        const maliciosa = sede('lorca', true);
        maliciosa.nombre = "O'Donnell & <Co>";
        render(raiz, vista({ sedes: [maliciosa] }));
        expect(raiz.querySelector('.sede__nombre')!.textContent).toBe("O'Donnell & <Co>");
    });

    it('el boton Llamar de una tarjeta enruta a llamar a ESA sede', () => {
        // Se afirma el ENRUTADO, no los atributos: que el toque llegue donde tiene
        // que llegar es una propiedad de la estructura del DOM, y asi el test no
        // depende de que la hoja de estilos haya cargado.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-sede="murcia"]')!;
        expect(enrutarToque(boton)).toEqual({ tipo: 'llamar', sede: 'murcia' });
    });

    it('el icono dentro del boton enruta igual que el boton', () => {
        // El dedo cae sobre el SVG, no sobre el <button>. Sin `closest` el toque
        // mas natural de todos no haria nada.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        const icono = raiz.querySelector('[data-sede="murcia"] svg')!;
        expect(enrutarToque(icono)).toEqual({ tipo: 'llamar', sede: 'murcia' });
    });

    it('tocar la tarjeta fuera del boton NO enruta nada', () => {
        // Un roce al pasar por delante del panel no puede lanzar una llamada.
        render(raiz, vista({ sedes: [sede('murcia', true)] }));
        expect(enrutarToque(raiz.querySelector('.sede__nombre'))).toBeNull();
    });

    it('un toque fuera de cualquier objetivo no enruta nada', () => {
        render(raiz, vista({}));
        expect(enrutarToque(raiz)).toBeNull();
        expect(enrutarToque(null)).toBeNull();
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
        const micro = raiz.querySelector('[data-accion="micro"]')!;
        const camara = raiz.querySelector('[data-accion="camara"]')!;
        expect(micro.getAttribute('aria-pressed')).toBe('false');
        expect(micro.getAttribute('aria-label')).toBe('Silenciar microfono');

        render(raiz, vista({ contexto: ctx, microSilenciado: true, camaraApagada: true }));
        expect(micro.getAttribute('aria-pressed')).toBe('true');
        expect(micro.getAttribute('aria-label')).toBe('Activar microfono');
        expect(camara.getAttribute('aria-pressed')).toBe('true');
        expect(micro.classList.contains('control--inactivo')).toBe(true);
        // Y el contenedor de video NO se ha reconstruido por el camino.
        expect(raiz.querySelectorAll('#jitsi')).toHaveLength(1);
    });

    it('los botones sin texto llevan etiqueta accesible y un icono', () => {
        // Los controles de llamada son solo icono. Sin `aria-label` serian botones
        // mudos para un lector de pantalla, y sin icono, botones vacios para todos.
        render(raiz, vista({ contexto: contextoEn('en-llamada') }));
        for (const accion of ['micro', 'camara', 'colgar']) {
            const boton = raiz.querySelector(`[data-accion="${accion}"]`)!;
            expect(boton.getAttribute('aria-label'), accion).not.toBeNull();
            expect(boton.querySelector('svg.icono'), accion).not.toBeNull();
        }
    });

    it('los iconos usan currentColor y no colores fijos', () => {
        // Heredar el color del boton es lo que evita mantener una variante de cada
        // icono por cada fondo. Un `stroke` o `fill` en duro se veria mal en cuanto
        // cambiara la paleta, y la paleta acaba de cambiar una vez.
        render(raiz, vista({ contexto: contextoEn('recibiendo') }));
        const iconos = raiz.querySelectorAll('svg.icono');
        expect(iconos.length).toBeGreaterThan(0);
        for (const icono of iconos) {
            expect(icono.getAttribute('stroke')).toBe('currentColor');
        }
    });

    it('en reposo se pinta la marca', () => {
        render(raiz, vista({}));
        const marca = raiz.querySelector<HTMLImageElement>('img.marca');
        expect(marca).not.toBeNull();
        expect(marca!.getAttribute('alt')).toBe('Victoria Crea');
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

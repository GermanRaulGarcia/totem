import type { NombreTimer } from './core/tipos';
import { ClienteMqtt } from './mqtt/cliente-mqtt';
import { SesionJitsi, type ApiJitsi } from './jitsi/sesion-jitsi';
import type { Sonidos, Temporizadores } from './runtime/interprete';
import { Totem } from './runtime/totem';
import { render } from './ui/pantallas';

const params = new URLSearchParams(location.search);
const SEDE = params.get('sede') ?? 'lorca';
const NOMBRE = params.get('nombre') ?? SEDE;
const URL_BROKER = params.get('broker') ?? `wss://${location.host}/mqtt`;
const HOST_JITSI = params.get('jitsi') ?? 'meet.sunube.net';

// Credencial MQTT por sede, entregada al kiosco como parametros de la URL de
// arranque, junto a ?sede= (ver infra/README.md). Mosquitto tiene
// allow_anonymous false y ACLs por usuario, asi que sin esto el broker responde
// CONNACK 5 a los tres totems y no arranca ninguno.
//
// Y NO, esto no hay que "endurecerlo": quien pueda leer la credencial de un
// kiosco ya tiene acceso fisico a ese totem y puede suplantar a esa sede de mil
// formas mas comodas. Lo que protegen las ACLs por sede -que una sede
// comprometida no pueda falsificar la presencia de OTRA- no depende de donde
// viva la credencial de esta. Un flujo de tokens aqui solo anadiria una pieza
// mas que se puede caer al arrancar, a cambio de cero seguridad real.
const USUARIO = params.get('usuario') ?? undefined;
const CONTRASENA = params.get('contrasena') ?? undefined;

const raiz = document.getElementById('app')!;

const timers: Temporizadores = (() => {
    const activos = new Map<NombreTimer, number>();
    return {
        arrancar(nombre, ms, cb) {
            const previo = activos.get(nombre);
            if (previo !== undefined) clearTimeout(previo);
            activos.set(nombre, window.setTimeout(cb, ms));
        },
        cancelar(nombre) {
            const id = activos.get(nombre);
            if (id !== undefined) { clearTimeout(id); activos.delete(nombre); }
        }
    };
})();

const sonidos: Sonidos = (() => {
    let bucle: number | null = null;
    const pitar = (frecuencia: number) => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gan = ctx.createGain();
        osc.frequency.value = frecuencia;
        gan.gain.value = 0.15;
        osc.connect(gan).connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); void ctx.close(); }, 400);
    };
    const parar = () => { if (bucle !== null) { clearInterval(bucle); bucle = null; } };
    return {
        sonarTimbre() { parar(); pitar(880); bucle = window.setInterval(() => pitar(880), 1500); },
        pararTimbre: parar,
        sonarRingback() { parar(); pitar(440); bucle = window.setInterval(() => pitar(440), 2500); },
        pararRingback: parar
    };
})();

const mqtt = new ClienteMqtt({
    url: URL_BROKER, sede: SEDE, nombre: NOMBRE,
    usuario: USUARIO, contrasena: CONTRASENA
});

const fabricaJitsi = (sala: string, contenedor: HTMLElement, displayName: string): ApiJitsi => {
    const Api = (window as unknown as { JitsiMeetExternalAPI: new (h: string, o: unknown) => ApiJitsi })
        .JitsiMeetExternalAPI;
    return new Api(HOST_JITSI, {
        roomName: sala,
        parentNode: contenedor,
        userInfo: { displayName },
        configOverwrite: {
            startWithAudioMuted: false,
            prejoinPageEnabled: false,
            toolbarButtons: []
        },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: [], SHOW_JITSI_WATERMARK: false }
    });
};

// El contenedor se resuelve en cada llamada, no aqui: `#jitsi` solo existe
// mientras esta pintada la pantalla de llamada. Pasar `raiz` colgaba el iframe
// como hermano de una seccion de 100dvh, es decir, fuera de pantalla.
const jitsi = new SesionJitsi(
    fabricaJitsi,
    () => raiz.querySelector<HTMLElement>('#jitsi'),
    NOMBRE
);

const reloj = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function pintar(): void {
    render(raiz, {
        contexto: totem.contexto,
        sedes: totem.sedes(),
        seleccion: totem.seleccion,
        reloj: reloj(),
        microSilenciado: jitsi.silenciado,
        camaraApagada: jitsi.camaraOculta
    });
}

const totem = new Totem({
    mqtt, jitsi, sonidos, timers, sede: SEDE,
    alCambiar: pintar,
    registrarPerdida: origen => console.warn('llamada perdida de', origen)
});

raiz.addEventListener('click', ev => {
    const objetivo = (ev.target as HTMLElement).closest<HTMLElement>('[data-accion], [data-sede]');
    if (objetivo === null) return;

    const sede = objetivo.dataset.sede;
    if (sede !== undefined && totem.contexto.estado === 'seleccionando') {
        totem.alternarSeleccion(sede);
        return;
    }

    switch (objetivo.dataset.accion) {
        case 'despertar': totem.emitir({ tipo: 'toque-pantalla' }); break;
        case 'llamar':
            totem.emitir({ tipo: 'seleccion-confirmada', destinos: [...totem.seleccion] });
            break;
        case 'cancelar': totem.emitir({ tipo: 'cancelar' }); break;
        case 'aceptar': totem.emitir({ tipo: 'aceptar' }); break;
        case 'rechazar': totem.emitir({ tipo: 'rechazar' }); break;
        case 'colgar': totem.emitir({ tipo: 'colgar' }); break;
        // Nunca alternan a ciegas: SesionJitsi lleva el estado real que reporta
        // Jitsi y declara el destino contrario. Pulsar dos veces no descuadra nada.
        case 'micro': jitsi.alternarMicro(); pintar(); break;
        case 'camara': jitsi.alternarCamara(); pintar(); break;
    }
});

// Un reloj de 12rem con un tick de 30 s ensena el minuto equivocado la mitad del
// tiempo. En reposo el repintado solo toca el textContent, asi que cada segundo
// es barato y ademas no reinicia la animacion anti burn-in.
setInterval(pintar, 1_000);
pintar();
totem.arrancar();

// 'pagehide' es el ultimo momento fiable para despedirse en un navegador
// ('unload' ya no lo garantiza Chrome). Sin esto la retraccion de presencia no
// llegaba a ejecutarse nunca, y el reinicio nocturno programado dejaba la sede
// marcada como viva hasta que el broker diera el socket por muerto.
addEventListener('pagehide', () => { void totem.parar(); });

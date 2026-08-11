import { AutoVista } from './runtime/autovista';
import { horaEn, horasDeSedes } from './core/horas';
import type { NombreTimer } from './core/tipos';
import { ClienteMqtt } from './mqtt/cliente-mqtt';
import { SesionJitsi, type ApiJitsi } from './jitsi/sesion-jitsi';
import type { Sonidos, Temporizadores } from './runtime/interprete';
import { RecargaPreventiva } from './runtime/recarga-preventiva';
import { Totem } from './runtime/totem';
import { enrutarToque, render } from './ui/pantallas';

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
        // Explicitos: el contenedor es una caja 16:9, no la pantalla entera, y el
        // iframe tiene que llenarla exactamente. Sin esto se depende del valor por
        // defecto de la version de Jitsi que este servida ese dia.
        width: '100%',
        height: '100%',
        userInfo: { displayName },
        configOverwrite: {
            startWithAudioMuted: false,
            prejoinPageEnabled: false,
            // Vista de orador: la otra sede grande y uno mismo en miniatura. Con
            // llamadas 1 a 1 es lo que Jitsi hace por defecto, pero se declara
            // para no depender de que ese defecto siga siendo el mismo manana.
            // La clave es `disableTileView`; `enterTileView` no existe en Jitsi.
            disableTileView: true,
            // Sin esto Jitsi esconde el filmstrip -y con el la miniatura propia-
            // porque el panel es vertical y entra en su umbral de "pantalla estrecha".
            // La miniatura propia la pinta AutoVista fuera del iframe, asi que
            // aqui se pide que Jitsi NO la muestre: dos veces la misma cara en la
            // misma pantalla, y una de ellas donde Jitsi decida.
            disableSelfView: true,
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

const autovista = new AutoVista();

const reloj = (ahora: Date) =>
    ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function pintar(): void {
    // Un solo instante para el reloj propio y para el de las sedes: pedir la hora
    // dos veces puede caer a los dos lados de un cambio de minuto y hacer que una
    // sede en la MISMA zona parezca tener una hora distinta.
    const ahora = new Date();
    // La hora de esta sede sale de su zona en `config/sedes`, no del reloj del
    // sistema; el reloj local solo es el respaldo de cuando el directorio aun no
    // ha llegado o no declara zona. Asi el totem muestra la hora que operaciones
    // dice que tiene esa oficina, en vez de la que tenga configurada el Windows.
    const propia = horaEn(totem.zonaPropia(), ahora) ?? reloj(ahora);
    const sedes = totem.sedes();
    render(raiz, {
        contexto: totem.contexto,
        sedes,
        propia: { sede: SEDE, nombre: NOMBRE },
        horas: horasDeSedes(sedes, propia, ahora),
        reloj: propia,
        microSilenciado: jitsi.silenciado,
        camaraApagada: jitsi.camaraOculta,
        brokerConectado: totem.conectado
    });

    // Mismo ciclo de vida que el iframe: la camara propia se abre al entrar en
    // llamada y se cierra al salir. Las dos operaciones son idempotentes, que es
    // lo que permite llamarlas desde cada repintado -uno por segundo, por el
    // reloj- sin pedir la camara una y otra vez.
    if (totem.contexto.estado === 'en-llamada') {
        void autovista.mostrar(raiz.querySelector<HTMLVideoElement>('#autovista'));
    } else {
        autovista.ocultar();
    }
}

const totem = new Totem({
    mqtt, jitsi, sonidos, timers, sede: SEDE,
    alCambiar: pintar,
    registrarPerdida: origen => console.warn('llamada perdida de', origen)
});

raiz.addEventListener('click', ev => {
    const toque = enrutarToque(ev.target);
    if (toque === null) return;
    if (toque.tipo === 'llamar') {
        // El boton solo se pinta para las sedes llamables, pero eso describe el
        // ultimo repintado, no el instante del toque: entre uno y otro cabe un
        // mensaje MQTT. Se revalida contra la presencia vigente ahora mismo.
        if (totem.esLlamableAhora(toque.sede)) {
            totem.emitir({ tipo: 'seleccion-confirmada', destino: toque.sede });
        }
        return;
    }

    switch (toque.accion) {
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

// Diseno §3.3: higiene preventiva contra la fuga de memoria de Chromium en
// sesiones de semanas. Espera a que el totem no tenga nada que interrumpir.
new RecargaPreventiva({
    estado: () => totem.contexto.estado,
    recargar: () => location.reload()
}).arrancar();

// 'pagehide' es el ultimo momento fiable para despedirse en un navegador
// ('unload' ya no lo garantiza Chrome). Sin esto la retraccion de presencia no
// llegaba a ejecutarse nunca, y el reinicio nocturno programado dejaba la sede
// marcada como viva hasta que el broker diera el socket por muerto.
addEventListener('pagehide', () => { void totem.parar(); });

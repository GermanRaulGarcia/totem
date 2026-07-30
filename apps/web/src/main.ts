import { contextoInicial, transicion } from './core/maquina-estados';
import type { Contexto, Evento, EstadoSede, NombreTimer } from './core/tipos';
import { ClienteMqtt } from './mqtt/cliente-mqtt';
import { SesionJitsi, type ApiJitsi } from './jitsi/sesion-jitsi';
import { Interprete, type Sonidos, type Temporizadores } from './runtime/interprete';
import { render } from './ui/pantallas';

const params = new URLSearchParams(location.search);
const SEDE = params.get('sede') ?? 'lorca';
const NOMBRE = params.get('nombre') ?? SEDE;
const URL_BROKER = params.get('broker') ?? `wss://${location.host}/mqtt`;
const HOST_JITSI = params.get('jitsi') ?? 'meet.sunube.net';

const raiz = document.getElementById('app')!;
let contexto: Contexto = contextoInicial();
let sedes: EstadoSede[] = [];
let seleccion: string[] = [];

const reloj = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function pintar(): void {
    render(raiz, { contexto, sedes, seleccion, reloj: reloj() });
}

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

const mqtt = new ClienteMqtt({ url: URL_BROKER, sede: SEDE, nombre: NOMBRE });

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

const jitsi = new SesionJitsi(fabricaJitsi, raiz, NOMBRE);

function emitir(evento: Evento): void {
    const resultado = transicion(contexto, evento);
    const cambio = resultado.contexto !== contexto;
    contexto = resultado.contexto;
    if (cambio) seleccion = [];
    pintar();
    void interprete.ejecutar(resultado.efectos);
}

const interprete = new Interprete(
    mqtt, jitsi, sonidos, timers, SEDE,
    origen => console.warn('llamada perdida de', origen),
    emitir
);

jitsi.alFallar(() => emitir({ tipo: 'jitsi-fallo' }));

mqtt.alConectar(() => emitir({ tipo: 'broker-conectado' }));
mqtt.alDesconectar(() => emitir({ tipo: 'broker-desconectado' }));
mqtt.alCambiarEstadoSede(estado => {
    if (estado.sede === SEDE) return;
    sedes = [...sedes.filter(s => s.sede !== estado.sede), estado]
        .sort((a, b) => a.sede.localeCompare(b.sede));
    pintar();
});
mqtt.alRecibirInvitacion(invitacion => emitir({ tipo: 'invitacion-recibida', invitacion }));
mqtt.alRecibirEventoLlamada(evento => {
    if (evento.tipo === 'acepta') emitir({ tipo: 'sede-acepto', sede: evento.sede });
});

raiz.addEventListener('click', ev => {
    const objetivo = (ev.target as HTMLElement).closest<HTMLElement>('[data-accion], [data-sede]');
    if (objetivo === null) return;

    const sede = objetivo.dataset.sede;
    if (sede !== undefined && contexto.estado === 'seleccionando') {
        seleccion = seleccion.includes(sede)
            ? seleccion.filter(s => s !== sede)
            : [...seleccion, sede];
        pintar();
        return;
    }

    switch (objetivo.dataset.accion) {
        case 'despertar': emitir({ tipo: 'toque-pantalla' }); break;
        case 'llamar': {
            const destinos = [...seleccion];
            emitir({ tipo: 'seleccion-confirmada', destinos });
            break;
        }
        case 'cancelar': emitir({ tipo: 'cancelar' }); break;
        case 'aceptar': emitir({ tipo: 'aceptar' }); break;
        case 'rechazar': emitir({ tipo: 'rechazar' }); break;
        case 'colgar': emitir({ tipo: 'colgar' }); break;
    }
});

setInterval(pintar, 30_000);
pintar();
void mqtt.conectar();

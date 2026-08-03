export interface ApiJitsi {
    executeCommand(comando: string, ...args: unknown[]): void;
    addEventListener(evento: string, cb: (datos: unknown) => void): void;
    dispose(): void;
    isAudioMuted(): Promise<boolean>;
}

export type FabricaJitsi = (
    sala: string, contenedor: HTMLElement, displayName: string
) => ApiJitsi;

/** El contenedor se resuelve en el momento de crear, no al construir. Ver `crear`. */
export type BuscadorContenedor = () => HTMLElement | null;

function estaSilenciado(datos: unknown): boolean {
    return typeof datos === 'object' && datos !== null && 'muted' in datos
        && (datos as { muted: unknown }).muted === true;
}

/**
 * Unico punto del sistema donde nace y muere el iframe de Jitsi.
 * Si esta clase es correcta, no puede quedar un iframe huerfano.
 */
export class SesionJitsi {
    private api: ApiJitsi | null = null;
    private cbFallo: () => void = () => {};
    private cbUnido: () => void = () => {};
    private cbCambioMedios: () => void = () => {};

    // Estado REAL del micro y la camara, sincronizado con los eventos de Jitsi.
    // El sistema antiguo alternaba a ciegas con toggleAudio y por eso el micro
    // acababa abierto de forma permanente (diseno §1.2, defectos 1-4). Aqui no se
    // alterna nunca a ciegas: se declara el estado destino y se reconcilia.
    private microSilenciado = false;
    private camaraApagada = false;

    constructor(
        private readonly fabrica: FabricaJitsi,
        private readonly buscarContenedor: BuscadorContenedor,
        private readonly displayName: string
    ) {}

    get activa(): boolean {
        return this.api !== null;
    }

    get silenciado(): boolean { return this.microSilenciado; }
    get camaraOculta(): boolean { return this.camaraApagada; }

    alFallar(cb: () => void): void { this.cbFallo = cb; }
    alUnirse(cb: () => void): void { this.cbUnido = cb; }
    alCambiarMedios(cb: () => void): void { this.cbCambioMedios = cb; }

    /**
     * El contenedor se busca AQUI, no en el constructor. `#jitsi` solo existe
     * mientras esta pintada la pantalla de llamada, asi que capturarlo al construir
     * obligaba a pasar `<main id="app">` y el iframe terminaba colgando como
     * hermano de una seccion de 100dvh: fuera de pantalla, en un kiosco que no
     * puede hacer scroll. Habia audio y no habia video, y `#jitsi` seguia dando
     * "visible" en el E2E porque es un div `position: fixed` vacio.
     */
    crear(sala: string): void {
        // Defensa: si por lo que sea quedaba una sesion, se cierra antes de abrir otra.
        this.destruir();

        const contenedor = this.buscarContenedor();
        if (contenedor === null) {
            console.error('no existe el contenedor de video: se aborta la llamada');
            this.cbFallo();
            return;
        }

        let nuevaApi: ApiJitsi;
        try {
            nuevaApi = this.fabrica(sala, contenedor, this.displayName);
        } catch (error) {
            // Caso real: /vendor/external_api.js no se descargo, asi que
            // window.JitsiMeetExternalAPI es undefined y el `new` revienta. Sin este
            // catch la maquina se quedaba en `en-llamada` con una pantalla negra y
            // sin forma de salir salvo pulsar Colgar a ciegas.
            console.error('no se pudo crear la sesion de Jitsi', error);
            this.cbFallo();
            return;
        }

        this.api = nuevaApi;
        this.microSilenciado = false;
        this.camaraApagada = false;

        // Guardia de identidad: solo dispara el callback si esta api sigue siendo la actual.
        // Esto previene que un listener stale de una sesion anterior (o que se está destruyendo)
        // atribuya falsamente un fallo a la sesion activa ahora.
        nuevaApi.addEventListener('videoConferenceLeft', () => {
            if (this.api === nuevaApi) this.cbFallo();
        });
        nuevaApi.addEventListener('videoConferenceJoined', () => {
            if (this.api === nuevaApi) this.cbUnido();
        });
        nuevaApi.addEventListener('audioMuteStatusChanged', datos => {
            if (this.api !== nuevaApi) return;
            this.microSilenciado = estaSilenciado(datos);
            this.cbCambioMedios();
        });
        nuevaApi.addEventListener('videoMuteStatusChanged', datos => {
            if (this.api !== nuevaApi) return;
            this.camaraApagada = estaSilenciado(datos);
            this.cbCambioMedios();
        });
    }

    /**
     * Declara el estado destino del micro. Idempotente: llamarlo dos veces con el
     * mismo valor no invierte nada. La iframe API solo ofrece `toggleAudio` (no
     * existe `muteAudio`, §1.2), asi que la unica forma correcta de usarla es
     * comparar contra el estado real antes de alternar.
     */
    fijarMicroSilenciado(silenciado: boolean): void {
        if (this.api === null || this.microSilenciado === silenciado) return;
        this.api.executeCommand('toggleAudio');
        // Anotacion optimista: el valor definitivo llega por audioMuteStatusChanged,
        // pero sin esto dos toques rapidos se cancelarian entre si.
        this.microSilenciado = silenciado;
    }

    fijarCamaraApagada(apagada: boolean): void {
        if (this.api === null || this.camaraApagada === apagada) return;
        this.api.executeCommand('toggleVideo');
        this.camaraApagada = apagada;
    }

    alternarMicro(): void { this.fijarMicroSilenciado(!this.microSilenciado); }
    alternarCamara(): void { this.fijarCamaraApagada(!this.camaraApagada); }

    destruir(): void {
        if (this.api === null) return;
        // Se anula la referencia ANTES de dispose(): si dispose dispara
        // videoConferenceLeft de forma sincrona, la guardia de identidad ya lo ve
        // como stale y no lo convierte en un fallo de una llamada que ya no existe.
        const api = this.api;
        this.api = null;
        api.dispose();
    }
}

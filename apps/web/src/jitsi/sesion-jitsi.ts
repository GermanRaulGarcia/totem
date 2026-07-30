export interface ApiJitsi {
    executeCommand(comando: string, ...args: unknown[]): void;
    addEventListener(evento: string, cb: (datos: never) => void): void;
    dispose(): void;
    isAudioMuted(): Promise<boolean>;
}

export type FabricaJitsi = (
    sala: string, contenedor: HTMLElement, displayName: string
) => ApiJitsi;

/**
 * Unico punto del sistema donde nace y muere el iframe de Jitsi.
 * Si esta clase es correcta, no puede quedar un iframe huerfano.
 */
export class SesionJitsi {
    private api: ApiJitsi | null = null;
    private cbFallo: () => void = () => {};

    constructor(
        private readonly fabrica: FabricaJitsi,
        private readonly contenedor: HTMLElement,
        private readonly displayName: string
    ) {}

    get activa(): boolean {
        return this.api !== null;
    }

    alFallar(cb: () => void): void {
        this.cbFallo = cb;
    }

    crear(sala: string): void {
        // Defensa: si por lo que sea quedaba una sesion, se cierra antes de abrir otra.
        this.destruir();
        this.api = this.fabrica(sala, this.contenedor, this.displayName);
        this.api.addEventListener('videoConferenceLeft', () => this.cbFallo());
    }

    destruir(): void {
        if (this.api === null) return;
        this.api.dispose();
        this.api = null;
    }
}

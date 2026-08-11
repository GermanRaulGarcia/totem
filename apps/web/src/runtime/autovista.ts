/**
 * La camara propia, en pequeño, sobre el video de la llamada.
 *
 * ¿Por que no la de Jitsi? Porque su miniatura vive en el *filmstrip*, y donde lo
 * coloca -o si lo llega a mostrar- lo decide Jitsi. El iframe es de otro dominio,
 * asi que su maquetacion no se toca por CSS desde fuera. Se intento con
 * `disableFilmstripAutohiding` y en el panel real no aparecia ninguna miniatura.
 * Pintandola nosotros, el tamaño y la esquina son decision nuestra.
 *
 * EL COSTE, dicho claro: son dos consumidores de la misma camara en la misma
 * maquina, el iframe de Jitsi y esto. Es aceptable por *cuando* ocurre: solo
 * mientras dura la llamada, que es justo cuando ya hay una sesion WebRTC entera
 * corriendo. En reposo -lo que el diseño protege, §3.3- no queda nada abierto.
 *
 * Por eso el ciclo de vida es el mismo que el del iframe: nace al entrar en
 * `en-llamada` y muere al salir. Un flujo de camara que sobreviva a la llamada es
 * el mismo defecto que este proyecto existe para eliminar, solo que mas
 * silencioso: no se ve, pero el piloto de la camara se queda encendido.
 */
export interface OpcionesAutoVista {
    /** Inyectable para poder probar sin camara ni navegador real. */
    pedirCamara?: (restricciones: MediaStreamConstraints) => Promise<MediaStream>;
}

/**
 * Resolucion pedida a proposito baja: esto se pinta en un recuadro de unos 300 px
 * en la esquina. Pedir 720p para eso seria gastar codificacion en pixeles que
 * nadie va a ver, en una maquina que tiene que aguantar semanas encendida.
 */
const RESTRICCIONES: MediaStreamConstraints = {
    video: { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 15 } },
    audio: false
};

export class AutoVista {
    private flujo: MediaStream | null = null;
    private pidiendo = false;
    private readonly pedirCamara: (r: MediaStreamConstraints) => Promise<MediaStream>;

    constructor(op: OpcionesAutoVista = {}) {
        this.pedirCamara = op.pedirCamara
            ?? (r => navigator.mediaDevices.getUserMedia(r));
    }

    /** Hay camara propia pintandose ahora mismo. */
    get activa(): boolean {
        return this.flujo !== null;
    }

    /**
     * Idempotente: se llama desde cada repintado, y el repintado ocurre cada
     * segundo por el reloj. Sin el guardado de `pidiendo`, un `getUserMedia` que
     * tarde en resolverse recibiria una peticion nueva por segundo.
     */
    async mostrar(destino: HTMLVideoElement | null): Promise<void> {
        if (destino === null || this.pidiendo) return;
        if (this.flujo !== null) {
            // El nodo se rehace si la pantalla se repinta entera; se reengancha.
            if (destino.srcObject !== this.flujo) destino.srcObject = this.flujo;
            return;
        }
        this.pidiendo = true;
        try {
            const flujo = await this.pedirCamara(RESTRICCIONES);
            // Entre la peticion y su respuesta puede haberse colgado la llamada.
            // Sin esta comprobacion, la camara quedaria abierta en reposo.
            if (!destino.isConnected) {
                for (const pista of flujo.getTracks()) pista.stop();
                return;
            }
            this.flujo = flujo;
            destino.srcObject = flujo;
        } catch (error) {
            // Que falle la miniatura NO puede tumbar la llamada: la conversacion
            // va por Jitsi y sigue perfectamente sin esto. Camara ocupada, permiso
            // denegado o driver que no admite dos aperturas: se queda sin
            // miniatura y ya.
            console.warn('sin camara propia en miniatura', error);
        } finally {
            this.pidiendo = false;
        }
    }

    /** Idempotente. Suelta las pistas: sin esto el piloto de la camara sigue encendido. */
    ocultar(): void {
        if (this.flujo === null) return;
        for (const pista of this.flujo.getTracks()) pista.stop();
        this.flujo = null;
    }
}

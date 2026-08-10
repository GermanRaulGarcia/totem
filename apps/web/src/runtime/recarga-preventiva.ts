import type { Estado } from '../core/tipos';

/** Diseno §3.3 y §7: recarga completa cada 6 h, solo con el totem en reposo. */
export const MS_RECARGA_PREVENTIVA = 6 * 60 * 60 * 1000;

/**
 * Cada cuanto se comprueba si toca. No es la precision de la recarga: es el
 * retardo maximo entre "el totem vuelve a reposo" y "se recarga" cuando el
 * vencimiento cayo en mitad de una llamada.
 */
export const MS_SONDEO_RECARGA = 60_000;

export interface OpcionesRecarga {
    /** El estado vigente de la maquina, leido en cada sondeo. */
    estado: () => Estado;
    recargar: () => void;
    /**
     * Reloj MONOTONO. `performance.now()` y no `Date.now()`: un ajuste de hora
     * -o el propio reinicio nocturno programado- no puede adelantar ni retrasar
     * la cuenta.
     */
    ahora?: () => number;
    ms?: number;
}

/**
 * Higiene preventiva contra la fuga de memoria de Chromium en sesiones largas.
 *
 * El redisenno reduce muchisimo la exposicion -en reposo no hay Jitsi cargado,
 * solo un WebSocket dormido- pero no la elimina: la pestana sigue siendo la
 * misma durante semanas. Esta es la segunda linea de defensa que el diseno pide
 * en §3.3, y la unica que actua sobre lo que ya se haya acumulado.
 *
 * NO recarga a la hora en punto: recarga en el primer sondeo posterior al
 * vencimiento en que el totem este en un estado sin nada que interrumpir. Una
 * recarga a mitad de conversacion seria un cuelgue autoinfligido, que es justo
 * lo que este proyecto existe para eliminar.
 */
export class RecargaPreventiva {
    private readonly ahora: () => number;
    private readonly ms: number;
    private readonly inicio: number;
    private sondeo: ReturnType<typeof setInterval> | null = null;
    private disparada = false;

    constructor(private readonly op: OpcionesRecarga) {
        this.ahora = op.ahora ?? (() => performance.now());
        this.ms = op.ms ?? MS_RECARGA_PREVENTIVA;
        this.inicio = this.ahora();
    }

    /**
     * Estados en los que recargar no interrumpe nada: no hay iframe, ni sonido,
     * ni nadie esperando delante del panel.
     *
     * `sin-conexion` entra a proposito, aunque el diseno diga "en reposo": ahi no
     * hay llamada ni usuario, y es ademas el caso en que una recarga mas puede
     * ayudar, porque rearranca de cero el cliente MQTT y su backoff. Excluirlo
     * significaria que un totem con el broker caido largo rato es precisamente el
     * que nunca se recarga.
     */
    private recargable(estado: Estado): boolean {
        return estado === 'inactivo' || estado === 'sin-conexion';
    }

    /** Un sondeo. Publico para poder probarlo con un reloj falso. */
    comprobar(): void {
        if (this.disparada) return;
        if (this.ahora() - this.inicio < this.ms) return;
        if (!this.recargable(this.op.estado())) return;
        this.disparada = true;
        this.parar();
        this.op.recargar();
    }

    arrancar(): void {
        if (this.sondeo !== null) return;
        this.sondeo = setInterval(() => this.comprobar(), MS_SONDEO_RECARGA);
    }

    parar(): void {
        if (this.sondeo === null) return;
        clearInterval(this.sondeo);
        this.sondeo = null;
    }
}

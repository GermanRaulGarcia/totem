import type { Efecto, Evento, NombreTimer } from '../core/tipos';
import type { ClienteMqtt } from '../mqtt/cliente-mqtt';
import type { SesionJitsi } from '../jitsi/sesion-jitsi';

export interface Sonidos {
    sonarTimbre(): void;
    pararTimbre(): void;
    sonarRingback(): void;
    pararRingback(): void;
}

export interface Temporizadores {
    arrancar(nombre: NombreTimer, ms: number, cb: () => void): void;
    cancelar(nombre: NombreTimer): void;
}

export class Interprete {
    constructor(
        private readonly mqtt: ClienteMqtt,
        private readonly jitsi: SesionJitsi,
        private readonly sonidos: Sonidos,
        private readonly timers: Temporizadores,
        private readonly sede: string,
        private readonly registrarPerdida: (origen: string) => void,
        private readonly emitir: (evento: Evento) => void
    ) {}

    /**
     * Cola de serializacion. `uno()` espera a I/O real (publicaciones QoS 1), asi
     * que dos lotes lanzados desde transiciones distintas podian solaparse: si un
     * publish del lote de `aceptar` se atascaba, el usuario colgaba, `destruir-jitsi`
     * corria con `api === null` y no hacia nada, y al desatascarse el publish el
     * lote antiguo seguia y CREABA el iframe con la maquina ya en `inactivo`.
     * Un iframe huerfano que nada volveria a destruir: el fallo original del
     * sistema antiguo por otra puerta. Encadenar los lotes lo hace imposible.
     */
    private cola: Promise<void> = Promise.resolve();

    ejecutar(efectos: Efecto[]): Promise<void> {
        const lote = this.cola.then(() => this.ejecutarLote(efectos));
        this.cola = lote;
        return lote;
    }

    /** Resuelve cuando la cola esta vacia. Para tests y cierres ordenados. */
    async enReposo(): Promise<void> {
        let anterior: Promise<void>;
        do {
            anterior = this.cola;
            await anterior;
        } while (this.cola !== anterior);
    }

    private async ejecutarLote(efectos: Efecto[]): Promise<void> {
        for (const efecto of efectos) {
            try {
                await this.uno(efecto);
            } catch (error) {
                // Un efecto que falla no puede abortar los demas: si el broker
                // esta caido, el iframe TIENE que destruirse igualmente.
                console.error('efecto fallido', efecto.tipo, error);
            }
        }
    }

    private async uno(efecto: Efecto): Promise<void> {
        switch (efecto.tipo) {
            case 'publicar-invitacion':
                await this.mqtt.publicarInvitacion(efecto.destino, {
                    callId: efecto.callId,
                    sala: efecto.sala,
                    origen: this.sede,
                    ts: new Date().toISOString()
                });
                return;

            case 'publicar-evento-llamada':
                await this.mqtt.publicarEventoLlamada(efecto.callId, efecto.evento);
                return;

            case 'publicar-estado':
                await this.mqtt.publicarEstado(efecto.disponibilidad, efecto.callId);
                return;

            case 'crear-jitsi':
                this.jitsi.crear(efecto.sala);
                return;

            // El `finally` NO es cosmetico. `teardown-completo` es la unica arista
            // de salida de `finalizando`, y este switch corre dentro del try/catch
            // de `ejecutarLote`, que se traga los errores. Emitiendolo solo en la
            // via de exito, un `dispose()` que lanzara dejaba la maquina en
            // `finalizando` para siempre: pantalla de "Finalizando..." congelada en
            // un kiosco desatendido, recuperable solo recargando. Declararlo
            // completo pase lo que pase es correcto ademas por construccion:
            // `SesionJitsi.destruir()` suelta su referencia ANTES de llamar a
            // `dispose()`, asi que al volver de aqui la sesion ya no existe para
            // este proceso, haya lanzado o no.
            case 'destruir-jitsi':
                try {
                    this.jitsi.destruir();
                } finally {
                    this.emitir({ tipo: 'teardown-completo' });
                }
                return;

            case 'sonar-timbre': this.sonidos.sonarTimbre(); return;
            case 'parar-timbre': this.sonidos.pararTimbre(); return;
            case 'sonar-ringback': this.sonidos.sonarRingback(); return;
            case 'parar-ringback': this.sonidos.pararRingback(); return;

            case 'arrancar-timer': {
                const nombre = efecto.nombre;
                this.timers.arrancar(nombre, efecto.ms, () => {
                    this.emitir(eventoDeTimer(nombre));
                });
                return;
            }

            case 'cancelar-timer':
                this.timers.cancelar(efecto.nombre);
                return;

            case 'registrar-perdida':
                this.registrarPerdida(efecto.origen);
                return;

            // `uno()` devuelve Promise<void>, asi que `strict` NO obliga a cubrir
            // todas las variantes: una variante nueva de Efecto se convertiria en
            // un no-op silencioso. Y en este switch viven crear-jitsi y
            // destruir-jitsi, asi que "silencioso" significa un iframe huerfano con
            // la suite en verde. El never lo convierte en error de compilacion, y
            // el throw es seguro porque ejecutarLote aisla cada efecto.
            default: {
                const _exhaustivo: never = efecto;
                throw new Error(`efecto no implementado: ${JSON.stringify(_exhaustivo)}`);
            }
        }
    }
}

function eventoDeTimer(nombre: NombreTimer): Evento {
    switch (nombre) {
        case 'seleccion': return { tipo: 'timeout-seleccion' };
        case 'sin-respuesta': return { tipo: 'sin-respuesta' };
        case 'union-jitsi': return { tipo: 'jitsi-fallo' };
        default: {
            const _exhaustivo: never = nombre;
            throw new Error(`timer no implementado: ${String(_exhaustivo)}`);
        }
    }
}

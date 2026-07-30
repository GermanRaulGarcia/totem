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

    async ejecutar(efectos: Efecto[]): Promise<void> {
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
            case 'publicar-invitaciones':
                for (const destino of efecto.destinos) {
                    await this.mqtt.publicarInvitacion(destino, {
                        callId: efecto.callId,
                        sala: efecto.sala,
                        origen: this.sede,
                        invitados: efecto.destinos,
                        ts: new Date().toISOString()
                    });
                }
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

            case 'destruir-jitsi':
                this.jitsi.destruir();
                this.emitir({ tipo: 'teardown-completo' });
                return;

            case 'sonar-timbre': this.sonidos.sonarTimbre(); return;
            case 'parar-timbre': this.sonidos.pararTimbre(); return;
            case 'sonar-ringback': this.sonidos.sonarRingback(); return;
            case 'parar-ringback': this.sonidos.pararRingback(); return;

            case 'arrancar-timer':
                this.timers.arrancar(efecto.nombre, efecto.ms, () => {
                    this.emitir(efecto.nombre === 'seleccion'
                        ? { tipo: 'timeout-seleccion' }
                        : { tipo: 'sin-respuesta' });
                });
                return;

            case 'cancelar-timer':
                this.timers.cancelar(efecto.nombre);
                return;

            case 'registrar-perdida':
                this.registrarPerdida(efecto.origen);
                return;
        }
    }
}

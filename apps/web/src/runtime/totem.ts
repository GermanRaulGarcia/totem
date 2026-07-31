import { contextoInicial, transicion } from '../core/maquina-estados';
import type { Contexto, EstadoSede, Evento, Sede } from '../core/tipos';
import type { ClienteMqtt } from '../mqtt/cliente-mqtt';
import type { SesionJitsi } from '../jitsi/sesion-jitsi';
import { Interprete, type Sonidos, type Temporizadores } from './interprete';

export interface OpcionesTotem {
    mqtt: ClienteMqtt;
    jitsi: SesionJitsi;
    sonidos: Sonidos;
    timers: Temporizadores;
    sede: string;
    /** Se invoca cada vez que hay algo nuevo que pintar. */
    alCambiar?: () => void;
    registrarPerdida?: (origen: string) => void;
}

/**
 * El cableado del totem: MQTT -> maquina de estados -> interprete.
 *
 * Vive aparte de `main.ts` a proposito. Los seis fallos criticos de la primera
 * revision estaban TODOS aqui, entre modulos, con 71 tests unitarios en verde:
 * cada pieza era correcta y el pegamento no lo probaba nadie. Al ser una clase
 * sin DOM se puede levantar dos totems en un test contra un broker en proceso.
 */
export class Totem {
    contexto: Contexto = contextoInicial();
    seleccion: string[] = [];

    private directorio: Sede[] = [];
    private readonly presencia = new Map<string, EstadoSede>();
    private readonly interprete: Interprete;
    private readonly op: OpcionesTotem;

    constructor(opciones: OpcionesTotem) {
        this.op = opciones;
        this.interprete = new Interprete(
            opciones.mqtt,
            opciones.jitsi,
            opciones.sonidos,
            opciones.timers,
            opciones.sede,
            origen => opciones.registrarPerdida?.(origen),
            evento => this.emitir(evento)
        );
    }

    /**
     * Lista de sedes a mostrar: el directorio retenido `config/sedes` sembrado
     * primero y la presencia en vivo por encima. Sin el directorio, una sede que
     * nunca ha conectado seria invisible en las demas pantallas y la promesa de
     * §9.2 ("instalar Murcia no requiere tocar Lorca ni Canarias") no se cumpliria.
     */
    sedes(): EstadoSede[] {
        const porId = new Map<string, EstadoSede>();
        for (const s of this.directorio) {
            if (s.id === this.op.sede) continue;
            porId.set(s.id, {
                sede: s.id, nombre: s.nombre, online: false,
                disponibilidad: 'libre', callId: null, ts: ''
            });
        }
        for (const [id, estado] of this.presencia) {
            if (id === this.op.sede) continue;
            porId.set(id, estado);
        }
        const orden = new Map(this.directorio.map(s => [s.id, s.orden]));
        const posicion = (id: string) => orden.get(id) ?? Number.MAX_SAFE_INTEGER;
        return [...porId.values()].sort(
            (a, b) => posicion(a.sede) - posicion(b.sede) || a.sede.localeCompare(b.sede)
        );
    }

    emitir(evento: Evento): void {
        const resultado = transicion(this.contexto, evento);
        const cambio = resultado.contexto !== this.contexto;
        this.contexto = resultado.contexto;
        if (cambio) this.seleccion = [];
        this.op.alCambiar?.();
        void this.interprete.ejecutar(resultado.efectos);
    }

    alternarSeleccion(sede: string): void {
        this.seleccion = this.seleccion.includes(sede)
            ? this.seleccion.filter(s => s !== sede)
            : [...this.seleccion, sede];
        this.op.alCambiar?.();
    }

    /** Registra los callbacks y abre la conexion. No espera al primer CONNACK. */
    arrancar(): void {
        const { mqtt, jitsi } = this.op;

        jitsi.alFallar(() => this.emitir({ tipo: 'jitsi-fallo' }));
        jitsi.alUnirse(() => this.emitir({ tipo: 'jitsi-unido' }));
        jitsi.alCambiarMedios(() => this.op.alCambiar?.());

        mqtt.alConectar(() => this.emitir({ tipo: 'broker-conectado' }));
        mqtt.alDesconectar(() => this.emitir({ tipo: 'broker-desconectado' }));
        mqtt.alRecibirDirectorio(sedes => {
            this.directorio = sedes;
            this.op.alCambiar?.();
        });
        mqtt.alCambiarEstadoSede(estado => {
            if (estado.sede === this.op.sede) return;
            this.presencia.set(estado.sede, estado);
            this.op.alCambiar?.();
        });
        mqtt.alRecibirInvitacion(invitacion => {
            this.emitir({ tipo: 'invitacion-recibida', invitacion });
        });
        mqtt.alRecibirEventoLlamada(evento => {
            // El topic de eventos es `llamada/+/evento`: llegan los de TODAS las
            // llamadas, incluidos los propios rebotados por el broker. Sin estos dos
            // filtros, un evento de una llamada ajena en curso se tomaria como propio
            // y podria colgar o alterar esta.
            if (evento.sede === this.op.sede) return;
            if (evento.callId !== this.contexto.callId) return;
            switch (evento.tipo) {
                case 'acepta': this.emitir({ tipo: 'sede-acepto', sede: evento.sede }); return;
                case 'rechaza': this.emitir({ tipo: 'sede-rechazo', sede: evento.sede }); return;
                case 'sin-respuesta':
                    this.emitir({ tipo: 'sede-sin-respuesta', sede: evento.sede });
                    return;
                case 'cuelga': this.emitir({ tipo: 'sede-colgo', sede: evento.sede }); return;
                case 'se-une': return; // Informativo: no cambia de estado.
            }
        });

        // conectar() ya no rechaza por un broker caido; solo por configuracion
        // invalida (un id de sede que no puede formar un topic). En ese caso el
        // totem no arrancara nunca, asi que hay que decirlo en pantalla.
        void this.op.mqtt.conectar().catch(error => {
            console.error('no se pudo iniciar la conexion MQTT', error);
            this.emitir({ tipo: 'broker-desconectado' });
        });
    }

    /** Cierre ordenado: retracta la presencia y suelta el iframe si lo hubiera. */
    async parar(): Promise<void> {
        this.op.jitsi.destruir();
        await this.op.mqtt.desconectar();
    }

    /** Resuelve cuando no quedan efectos pendientes. Para tests. */
    efectosAplicados(): Promise<void> {
        return this.interprete.enReposo();
    }
}

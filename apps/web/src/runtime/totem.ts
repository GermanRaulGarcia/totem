import { contextoInicial, transicion } from '../core/maquina-estados';
import { esLlamable, type Contexto, type EstadoSede, type Evento, type Sede } from '../core/tipos';
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
    /**
     * Hay broker AHORA MISMO. Es estado del TRANSPORTE y por eso vive aqui y no
     * en el contexto de la maquina: durante `en-llamada` la FSM se queda donde
     * esta aunque el broker caiga (§3.2), asi que `contexto.estado` no puede
     * responder a esta pregunta. La interfaz lo necesita para avisar de que se
     * ha perdido la presencia sin cortar la conversacion.
     */
    conectado = false;

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
        this.contexto = resultado.contexto;
        this.op.alCambiar?.();
        void this.interprete.ejecutar(resultado.efectos);
    }

    /**
     * ¿Se puede llamar a esta sede AHORA MISMO?
     *
     * El boton solo se pinta para las sedes llamables, pero eso es una propiedad
     * del marcado en el instante del ultimo repintado, no una garantia. Entre ese
     * repintado y el dedo cabe un mensaje MQTT: la sede puede haber colgado el
     * cartel de ocupada o haberse caido de la red. Sin esta comprobacion, la
     * invitacion saldria hacia un totem que ya no puede contestarla y el llamante
     * se comeria 45 s de "Sonando..." para nadie.
     */
    esLlamableAhora(sede: string): boolean {
        const estado = this.sedes().find(s => s.sede === sede);
        return estado !== undefined && esLlamable(estado);
    }

    /** Registra los callbacks y abre la conexion. No espera al primer CONNACK. */
    arrancar(): void {
        const { mqtt, jitsi } = this.op;

        jitsi.alFallar(() => this.emitir({ tipo: 'jitsi-fallo' }));
        jitsi.alUnirse(() => this.emitir({ tipo: 'jitsi-unido' }));
        jitsi.alCambiarMedios(() => this.op.alCambiar?.());

        // El flag se actualiza ANTES de emitir: `emitir` repinta, y el repintado
        // tiene que ver ya el valor nuevo.
        mqtt.alConectar(() => {
            this.conectado = true;
            this.emitir({ tipo: 'broker-conectado' });
        });
        mqtt.alDesconectar(() => {
            this.conectado = false;
            this.emitir({ tipo: 'broker-desconectado' });
        });
        mqtt.alRecibirDirectorio(sedes => {
            this.directorio = sedes;
            this.op.alCambiar?.();
        });
        mqtt.alCambiarEstadoSede(estado => {
            if (estado.sede === this.op.sede) return;
            this.presencia.set(estado.sede, estado);
            // Repintar hace desaparecer el boton Llamar de una sede que acaba de
            // ocuparse o caerse. La comprobacion que manda sigue siendo
            // `esLlamableAhora` en el instante del toque: esto solo evita ofrecer
            // lo que ya no se puede hacer.
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
                // Al retirarse `se-une` el switch quedo exhaustivo. Se fija con un
                // never para que anadir un tipo de evento futuro sea un error de
                // compilacion y no un mensaje que se pierde en silencio.
                default: {
                    const _exhaustivo: never = evento.tipo;
                    console.error('evento de llamada no contemplado', _exhaustivo);
                }
            }
        });

        // conectar() ya no rechaza por un broker caido; solo por configuracion
        // invalida (un id de sede que no puede formar un topic). En ese caso el
        // totem no arrancara nunca, asi que hay que decirlo en pantalla.
        void this.op.mqtt.conectar().catch(error => {
            console.error('no se pudo iniciar la conexion MQTT', error);
            this.conectado = false;
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

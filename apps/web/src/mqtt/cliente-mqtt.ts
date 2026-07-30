import mqtt, { type MqttClient } from 'mqtt';
import {
    PATRON_ESTADOS, topicEstado, topicEventoLlamada, topicInvitacion
} from './topics';
import type {
    Disponibilidad, EstadoSede, EventoLlamada, Invitacion, TipoEventoLlamada
} from '../core/tipos';

export interface OpcionesCliente {
    url: string;
    sede: string;
    nombre: string;
    usuario?: string;
    contrasena?: string;
}

const PATRON_EVENTOS_LLAMADA = 'llamada/+/evento';

export class ClienteMqtt {
    private cliente: MqttClient | null = null;
    private readonly op: OpcionesCliente;

    private cbEstado: (e: EstadoSede) => void = () => {};
    private cbInvitacion: (i: Invitacion) => void = () => {};
    private cbEventoLlamada: (e: EventoLlamada) => void = () => {};
    private cbConectar: () => void = () => {};
    private cbDesconectar: () => void = () => {};

    constructor(opciones: OpcionesCliente) {
        this.op = opciones;
    }

    alCambiarEstadoSede(cb: (e: EstadoSede) => void): void { this.cbEstado = cb; }
    alRecibirInvitacion(cb: (i: Invitacion) => void): void { this.cbInvitacion = cb; }
    alRecibirEventoLlamada(cb: (e: EventoLlamada) => void): void { this.cbEventoLlamada = cb; }
    alConectar(cb: () => void): void { this.cbConectar = cb; }
    alDesconectar(cb: () => void): void { this.cbDesconectar = cb; }

    private cuerpoEstado(online: boolean, disponibilidad: Disponibilidad, callId: string | null): string {
        const estado: EstadoSede = {
            sede: this.op.sede,
            nombre: this.op.nombre,
            online,
            disponibilidad,
            callId,
            ts: new Date().toISOString()
        };
        return JSON.stringify(estado);
    }

    async conectar(): Promise<void> {
        // El LWT DEBE ir con retain: true. Si no, no sobrescribe el estado
        // retenido "online" y la sede aparece viva para siempre tras una caida.
        this.cliente = mqtt.connect(this.op.url, {
            clientId: `totem-${this.op.sede}`,
            username: this.op.usuario,
            password: this.op.contrasena,
            clean: true,
            reconnectPeriod: 1000,
            will: {
                topic: topicEstado(this.op.sede),
                payload: Buffer.from(this.cuerpoEstado(false, 'libre', null)),
                qos: 1,
                retain: true
            }
        });

        this.cliente.on('message', (topic, payload) => this.despachar(topic, payload));
        this.cliente.on('close', () => this.cbDesconectar());
        this.cliente.on('offline', () => this.cbDesconectar());

        await new Promise<void>((resolve, reject) => {
            this.cliente!.once('connect', () => resolve());
            this.cliente!.once('error', reject);
        });

        await this.cliente.subscribeAsync([
            PATRON_ESTADOS,
            topicInvitacion(this.op.sede),
            PATRON_EVENTOS_LLAMADA
        ], { qos: 1 });

        await this.publicarEstado('libre', null);
        this.cbConectar();
    }

    private despachar(topic: string, payload: Buffer): void {
        let datos: unknown;
        try {
            datos = JSON.parse(payload.toString());
        } catch {
            return; // Un payload corrupto no puede tumbar el totem.
        }
        if (topic.endsWith('/estado')) this.cbEstado(datos as EstadoSede);
        else if (topic.endsWith('/invitacion')) this.cbInvitacion(datos as Invitacion);
        else if (topic.endsWith('/evento')) this.cbEventoLlamada(datos as EventoLlamada);
    }

    async publicarEstado(disponibilidad: Disponibilidad, callId: string | null): Promise<void> {
        await this.cliente?.publishAsync(
            topicEstado(this.op.sede),
            this.cuerpoEstado(true, disponibilidad, callId),
            { qos: 1, retain: true }
        );
    }

    async publicarInvitacion(destino: string, invitacion: Invitacion): Promise<void> {
        // Sin retain: una invitacion caducada no debe resucitar al reconectar.
        await this.cliente?.publishAsync(
            topicInvitacion(destino), JSON.stringify(invitacion), { qos: 1, retain: false }
        );
    }

    async publicarEventoLlamada(callId: string, tipo: TipoEventoLlamada): Promise<void> {
        const evento: EventoLlamada = {
            callId, sede: this.op.sede, tipo, ts: new Date().toISOString()
        };
        await this.cliente?.publishAsync(
            topicEventoLlamada(callId), JSON.stringify(evento), { qos: 1, retain: false }
        );
    }

    async desconectar(): Promise<void> {
        if (this.cliente === null) return;
        // Si la conexion ya se corto de golpe (matarConexionParaTest), el cliente
        // mqtt.js queda en disconnecting=true para siempre y publicar rechaza con
        // "client disconnecting". No hay despedida posible: solo cerramos.
        if (!this.cliente.disconnecting) {
            // Un DISCONNECT limpio (no forzado) hace que el broker DESCARTE el Will,
            // por lo que el offline que normalmente pondria el LWT nunca llega. El
            // cliente tiene que retractar su propia presencia con el mismo payload
            // que usaria el Will (cuerpoEstado(false, ...)) antes de desconectarse;
            // si publicaramos 'libre' con online:true, el estado retenido quedaria
            // "vivo para siempre" pese a haberse ido de forma ordenada.
            await this.cliente.publishAsync(
                topicEstado(this.op.sede),
                this.cuerpoEstado(false, 'libre', null),
                { qos: 1, retain: true }
            );
        }
        await this.cliente.endAsync();
        this.cliente = null;
    }

    /** Corta el socket sin despedirse, para provocar el LWT en los tests. */
    matarConexionParaTest(): void {
        this.cliente?.end(true);
    }
}

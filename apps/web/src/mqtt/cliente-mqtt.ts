import mqtt, { type MqttClient } from 'mqtt';
import {
    PATRON_ESTADOS, PATRON_EVENTOS_LLAMADA, TOPIC_CONFIG_SEDES,
    topicEstado, topicEventoLlamada, topicInvitacion
} from './topics';
import type {
    Disponibilidad, EstadoSede, EventoLlamada, Invitacion, Sede, TipoEventoLlamada
} from '../core/tipos';

export interface OpcionesCliente {
    url: string;
    sede: string;
    nombre: string;
    usuario?: string;
    contrasena?: string;
}

/**
 * Diseno §4.2: "las demas sedes lo ven en segundos". El keepalive por defecto de
 * mqtt.js es 60 s y el broker espera 1,5 keepalives antes de dar el socket por
 * muerto y publicar el LWT: hasta 90 s de retraso. Con 20 s el peor caso baja a 30.
 */
const KEEPALIVE_SEGUNDOS = 20;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function cadena(valor: unknown): valor is string {
    return typeof valor === 'string' && valor.trim() !== '';
}

// Todo lo que entra por MQTT es texto de red sin validar, incluso viniendo de una
// sede con credenciales validas o de un `mosquitto_pub` tecleado a mano por
// operaciones. Estos lectores devuelven null en vez de castear a ciegas: un
// payload retenido mal escrito, si se aceptara, quedaria roto en los tres kiosks
// desatendidos hasta que alguien lo sobrescribiera.
function leerEstado(datos: unknown): EstadoSede | null {
    if (!esObjeto(datos) || !cadena(datos.sede)) return null;
    return {
        sede: datos.sede,
        nombre: cadena(datos.nombre) ? datos.nombre : datos.sede,
        online: datos.online === true,
        disponibilidad: datos.disponibilidad === 'ocupado' ? 'ocupado' : 'libre',
        callId: cadena(datos.callId) ? datos.callId : null,
        ts: cadena(datos.ts) ? datos.ts : ''
    };
}

function leerInvitacion(datos: unknown): Invitacion | null {
    if (!esObjeto(datos)) return null;
    if (!cadena(datos.callId) || !cadena(datos.sala) || !cadena(datos.origen)) return null;
    const invitados = Array.isArray(datos.invitados) ? datos.invitados.filter(cadena) : [];
    return {
        callId: datos.callId,
        sala: datos.sala,
        origen: datos.origen,
        invitados,
        ts: cadena(datos.ts) ? datos.ts : ''
    };
}

const TIPOS_EVENTO: readonly TipoEventoLlamada[] =
    ['acepta', 'rechaza', 'sin-respuesta', 'se-une', 'cuelga'];

function leerEventoLlamada(datos: unknown): EventoLlamada | null {
    if (!esObjeto(datos)) return null;
    if (!cadena(datos.callId) || !cadena(datos.sede)) return null;
    const tipo = TIPOS_EVENTO.find(t => t === datos.tipo);
    if (tipo === undefined) return null;
    return {
        callId: datos.callId,
        sede: datos.sede,
        tipo,
        ts: cadena(datos.ts) ? datos.ts : ''
    };
}

function leerDirectorio(datos: unknown): Sede[] | null {
    if (!esObjeto(datos) || !Array.isArray(datos.sedes)) return null;
    const sedes: Sede[] = [];
    for (const bruto of datos.sedes) {
        if (!esObjeto(bruto) || !cadena(bruto.id)) continue;
        sedes.push({
            id: bruto.id,
            nombre: cadena(bruto.nombre) ? bruto.nombre : bruto.id,
            orden: typeof bruto.orden === 'number' && Number.isFinite(bruto.orden)
                ? bruto.orden
                : Number.MAX_SAFE_INTEGER
        });
    }
    return sedes;
}

export class ClienteMqtt {
    private cliente: MqttClient | null = null;
    private readonly op: OpcionesCliente;

    private cbEstado: (e: EstadoSede) => void = () => {};
    private cbInvitacion: (i: Invitacion) => void = () => {};
    private cbEventoLlamada: (e: EventoLlamada) => void = () => {};
    private cbDirectorio: (s: Sede[]) => void = () => {};
    private cbConectar: () => void = () => {};
    private cbDesconectar: () => void = () => {};

    constructor(opciones: OpcionesCliente) {
        this.op = opciones;
    }

    alCambiarEstadoSede(cb: (e: EstadoSede) => void): void { this.cbEstado = cb; }
    alRecibirInvitacion(cb: (i: Invitacion) => void): void { this.cbInvitacion = cb; }
    alRecibirEventoLlamada(cb: (e: EventoLlamada) => void): void { this.cbEventoLlamada = cb; }
    alRecibirDirectorio(cb: (s: Sede[]) => void): void { this.cbDirectorio = cb; }
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

    /**
     * Abre la conexion y devuelve el control de inmediato: NO espera al primer
     * CONNACK. La maquina de estados ya modela "todavia no conectado" como
     * `arrancando`, y esperar aqui hacia que un broker caido al arrancar rechazara
     * la promesa antes de suscribirse a nada, dejando el totem sordo para siempre.
     * Solo rechaza si la configuracion es invalida (p. ej. un id de sede que no
     * puede formar un topic).
     */
    async conectar(): Promise<void> {
        // El LWT DEBE ir con retain: true. Si no, no sobrescribe el estado
        // retenido "online" y la sede aparece viva para siempre tras una caida.
        const will = {
            topic: topicEstado(this.op.sede),
            payload: this.cuerpoEstado(false, 'libre', null),
            qos: 1 as const,
            retain: true
        };

        this.cliente = mqtt.connect(this.op.url, {
            clientId: `totem-${this.op.sede}`,
            username: this.op.usuario,
            password: this.op.contrasena,
            clean: true,
            reconnectPeriod: 1000,
            keepalive: KEEPALIVE_SEGUNDOS,
            will
        });

        this.cliente.on('message', (topic, payload) => this.despachar(topic, payload));
        this.cliente.on('close', () => this.cbDesconectar());
        this.cliente.on('offline', () => this.cbDesconectar());
        // No rechaza ninguna promesa: nadie estaria escuchandola y se convertiria
        // en un unhandledrejection. mqtt.js reintenta solo cada reconnectPeriod.
        this.cliente.on('error', error => console.error('error de MQTT', error));

        // PERSISTENTE, no `once`. mqtt.js emite 'connect' en CADA CONNACK,
        // tambien en las reconexiones. Con `once`, la primera caida del broker
        // dejaba el totem sin volver a suscribirse ni a republicar su presencia:
        // MQTT estaba sano por debajo y la pantalla decia "Sin conexion" para
        // siempre, mientras las demas sedes lo veian gris y no pulsable. La unica
        // averia que la presencia MQTT existe para cubrir era la que lo inutilizaba.
        this.cliente.on('connect', () => void this.unirse());
    }

    /**
     * Secuencia de enganche. Se ejecuta entera en cada CONNACK, no solo en el
     * primero.
     *
     * Aqui NO se publica la presencia. Antes se hacia, con `('libre', null)`
     * fijo, y eso convertia cada parpadeo del broker en una mentira retenida: la
     * maquina de estados se queda deliberadamente en `en-llamada` cuando cae el
     * broker (diseno §3.2), asi que el reenganche anunciaba `libre, callId:null`
     * para una sede que seguia hablando, y ahi se quedaba el resto de la llamada.
     * Otra sede la veia disponible y la llamaba a 45 s de silencio.
     *
     * Esta capa no sabe si hay una llamada en curso y no debe adivinarlo. Publica
     * quien lo sabe: `broker-conectado` emite el `publicar-estado` correcto segun
     * el estado real (`libre` en reposo, `ocupado` + `callId` en llamada).
     */
    private async unirse(): Promise<void> {
        const cliente = this.cliente;
        if (cliente === null) return;
        try {
            await cliente.subscribeAsync([
                PATRON_ESTADOS,
                topicInvitacion(this.op.sede),
                PATRON_EVENTOS_LLAMADA,
                TOPIC_CONFIG_SEDES
            ], { qos: 1 });
        } catch (error) {
            console.error('fallo al reengancharse tras conectar', error);
            return;
        }
        this.cbConectar();
    }

    private despachar(topic: string, payload: Buffer): void {
        const texto = payload.toString();
        // Payload vacio: es como MQTT borra un retenido. No es JSON ni es un error.
        if (texto === '') return;

        let datos: unknown;
        try {
            datos = JSON.parse(texto);
        } catch (error) {
            // Un payload corrupto no puede tumbar el totem, pero tampoco puede
            // desaparecer en silencio: sin esta traza, un retenido mal tecleado
            // falla de forma invisible en tres kiosks desatendidos.
            console.error('payload MQTT ilegible', topic, texto.slice(0, 200), error);
            return;
        }

        if (topic === TOPIC_CONFIG_SEDES) {
            const sedes = leerDirectorio(datos);
            if (sedes === null) { this.descartar(topic, texto); return; }
            this.cbDirectorio(sedes);
            return;
        }
        if (topic.endsWith('/estado')) {
            const estado = leerEstado(datos);
            if (estado === null) { this.descartar(topic, texto); return; }
            this.cbEstado(estado);
            return;
        }
        if (topic.endsWith('/invitacion')) {
            const invitacion = leerInvitacion(datos);
            if (invitacion === null) { this.descartar(topic, texto); return; }
            this.cbInvitacion(invitacion);
            return;
        }
        if (topic.endsWith('/evento')) {
            const evento = leerEventoLlamada(datos);
            if (evento === null) { this.descartar(topic, texto); return; }
            this.cbEventoLlamada(evento);
        }
    }

    private descartar(topic: string, texto: string): void {
        console.error('payload MQTT con forma invalida, descartado', topic, texto.slice(0, 200));
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
        const cliente = this.cliente;
        if (cliente === null) return;
        this.cliente = null;
        // Si la conexion ya se corto de golpe (matarConexionParaTest), mqtt.js queda
        // en disconnecting=true para siempre y publicar rechaza con "client
        // disconnecting". Y si nunca llego a conectar, un publish QoS 1 se encola
        // sin resolverse jamas y esta promesa no volveria. En ambos casos no hay
        // despedida posible: solo cerramos.
        if (cliente.connected && !cliente.disconnecting) {
            // Un DISCONNECT limpio (no forzado) hace que el broker DESCARTE el Will,
            // por lo que el offline que normalmente pondria el LWT nunca llega. El
            // cliente tiene que retractar su propia presencia con el mismo payload
            // que usaria el Will (cuerpoEstado(false, ...)) antes de desconectarse;
            // si publicaramos 'libre' con online:true, el estado retenido quedaria
            // "vivo para siempre" pese a haberse ido de forma ordenada.
            try {
                await cliente.publishAsync(
                    topicEstado(this.op.sede),
                    this.cuerpoEstado(false, 'libre', null),
                    { qos: 1, retain: true }
                );
            } catch (error) {
                console.error('no se pudo retractar la presencia al cerrar', error);
            }
        }
        await cliente.endAsync();
    }

    /** Corta el socket sin despedirse, para provocar el LWT en los tests. */
    matarConexionParaTest(): void {
        this.cliente?.end(true);
    }
}

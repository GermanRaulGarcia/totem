import { Aedes } from 'aedes';
import { createServer as crearTcp, type Server, type Socket } from 'node:net';
import { createServer as crearHttp } from 'node:http';
import { WebSocketServer, createWebSocketStream } from 'ws';

export interface BrokerDePrueba {
    url: string;
    urlWs: string;
    /** Puertos efectivos, para poder volver a levantar el broker en el mismo sitio. */
    puerto: number;
    puertoWs: number;
    parar: () => Promise<void>;
}

export interface OpcionesBroker {
    /** 0 (por defecto) pide un puerto libre al sistema. */
    puerto?: number;
    puertoWs?: number;
}

/** Arranca un broker MQTT en proceso, con puertos TCP y WebSocket. Sin Docker, sin red externa. */
export async function arrancarBroker(op: OpcionesBroker = {}): Promise<BrokerDePrueba> {
    // La version instalada de aedes elimino el export por defecto (new Aedes());
    // ahora exige el factory estatico Aedes.createBroker(), que ademas deja el
    // broker "escuchando" (persistence lista para retained/LWT).
    const aedes = await Aedes.createBroker();
    // Se lleva la cuenta de los sockets TCP vivos: `server.close()` deja de aceptar
    // conexiones nuevas pero ESPERA a que las abiertas se cierren solas. Sin
    // destruirlas a mano, simular una caida del broker con clientes conectados
    // (que es justo lo que hay que probar) colgaria el test para siempre.
    const conexiones = new Set<Socket>();
    const tcp: Server = crearTcp(socket => {
        conexiones.add(socket);
        socket.on('close', () => conexiones.delete(socket));
        (aedes.handle as (s: Socket) => void)(socket);
    });
    const http = crearHttp();
    const wss = new WebSocketServer({ server: http });
    wss.on('connection', socket => {
        const flujo = createWebSocketStream(socket);
        aedes.handle(flujo as never, socket as never);
    });

    await new Promise<void>(resolve => tcp.listen(op.puerto ?? 0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => http.listen(op.puertoWs ?? 0, '127.0.0.1', resolve));

    const dirTcp = tcp.address();
    const dirHttp = http.address();
    if (dirTcp === null || typeof dirTcp === 'string') throw new Error('sin puerto tcp');
    if (dirHttp === null || typeof dirHttp === 'string') throw new Error('sin puerto ws');

    return {
        url: `mqtt://127.0.0.1:${dirTcp.port}`,
        urlWs: `ws://127.0.0.1:${dirHttp.port}`,
        puerto: dirTcp.port,
        puertoWs: dirHttp.port,
        parar: async () => {
            for (const socket of wss.clients) socket.terminate();
            await new Promise<void>(resolve => wss.close(() => resolve()));
            http.closeAllConnections();
            await new Promise<void>(resolve => http.close(() => resolve()));
            for (const socket of conexiones) socket.destroy();
            conexiones.clear();
            await new Promise<void>(resolve => tcp.close(() => resolve()));
            await new Promise<void>(resolve => aedes.close(() => resolve()));
        }
    };
}

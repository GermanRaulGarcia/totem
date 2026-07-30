import { Aedes } from 'aedes';
import { createServer as crearTcp, type Server } from 'node:net';
import { createServer as crearHttp } from 'node:http';
import { WebSocketServer, createWebSocketStream } from 'ws';

export interface BrokerDePrueba {
    url: string;
    urlWs: string;
    parar: () => Promise<void>;
}

/** Arranca un broker MQTT en proceso, con puertos TCP y WebSocket. Sin Docker, sin red externa. */
export async function arrancarBroker(): Promise<BrokerDePrueba> {
    // La version instalada de aedes elimino el export por defecto (new Aedes());
    // ahora exige el factory estatico Aedes.createBroker(), que ademas deja el
    // broker "escuchando" (persistence lista para retained/LWT).
    const aedes = await Aedes.createBroker();
    const tcp: Server = crearTcp(aedes.handle as never);
    const http = crearHttp();
    const wss = new WebSocketServer({ server: http });
    wss.on('connection', socket => {
        const flujo = createWebSocketStream(socket);
        aedes.handle(flujo as never, socket as never);
    });

    await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));

    const dirTcp = tcp.address();
    const dirHttp = http.address();
    if (dirTcp === null || typeof dirTcp === 'string') throw new Error('sin puerto tcp');
    if (dirHttp === null || typeof dirHttp === 'string') throw new Error('sin puerto ws');

    return {
        url: `mqtt://127.0.0.1:${dirTcp.port}`,
        urlWs: `ws://127.0.0.1:${dirHttp.port}`,
        parar: () => new Promise<void>(resolve => {
            wss.close(() => http.close(() => tcp.close(() => aedes.close(() => resolve()))));
        })
    };
}

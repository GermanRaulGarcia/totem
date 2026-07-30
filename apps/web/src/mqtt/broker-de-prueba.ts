import { Aedes } from 'aedes';
import { createServer, type Server } from 'node:net';

export interface BrokerDePrueba {
    url: string;
    parar: () => Promise<void>;
}

/** Arranca un broker MQTT en proceso. Sin Docker, sin red externa. */
export async function arrancarBroker(): Promise<BrokerDePrueba> {
    // La version instalada de aedes elimino el export por defecto (new Aedes());
    // ahora exige el factory estatico Aedes.createBroker(), que ademas deja el
    // broker "escuchando" (persistence lista para retained/LWT).
    const aedes = await Aedes.createBroker();
    const server: Server = createServer(aedes.handle as never);

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const dir = server.address();
    if (dir === null || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');

    return {
        url: `mqtt://127.0.0.1:${dir.port}`,
        parar: () => new Promise<void>(resolve => {
            server.close(() => aedes.close(() => resolve()));
        })
    };
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mqtt from 'mqtt';
import { arrancarBroker, type BrokerDePrueba } from './broker-de-prueba';
import { ClienteMqtt } from './cliente-mqtt';
import { TOPIC_CONFIG_SEDES } from './topics';
import type { EstadoSede, Sede } from '../core/tipos';

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * `conectar()` ya no espera al primer CONNACK a proposito (ver cliente-mqtt.ts),
 * asi que los tests esperan al enganche completo: suscripcion + presencia publicada.
 */
function espiaUniones(c: ClienteMqtt) {
    let total = 0;
    const esperas: Array<{ n: number; resolver: () => void }> = [];
    c.alConectar(() => {
        total++;
        for (const espera of esperas.splice(0)) {
            if (total >= espera.n) espera.resolver();
            else esperas.push(espera);
        }
    });
    return {
        get total() { return total; },
        hasta(n: number): Promise<void> {
            if (total >= n) return Promise.resolve();
            return new Promise<void>(resolver => esperas.push({ n, resolver }));
        }
    };
}

async function conectarYEsperar(c: ClienteMqtt): Promise<void> {
    const uniones = espiaUniones(c);
    await c.conectar();
    await uniones.hasta(1);
}

describe('ClienteMqtt', () => {
    let broker: BrokerDePrueba;
    const clientes: ClienteMqtt[] = [];

    const nuevo = (sede: string, nombre: string) => {
        const c = new ClienteMqtt({ url: broker.url, sede, nombre });
        clientes.push(c);
        return c;
    };

    /** Publica sin pasar por ClienteMqtt, para simular a operaciones o a un tercero. */
    const publicarCrudo = async (topic: string, payload: string, retain = false) => {
        const bruto = await mqtt.connectAsync(broker.url);
        await bruto.publishAsync(topic, payload, { qos: 1, retain });
        await bruto.endAsync();
    };

    beforeEach(async () => { broker = await arrancarBroker(); });
    afterEach(async () => {
        await Promise.all(clientes.splice(0).map(c => c.desconectar()));
        await broker.parar();
    });

    it('publica su presencia al conectar', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(canarias);
        await esperar(100);

        const deLorca = recibidos.find(e => e.sede === 'lorca');
        expect(deLorca).toBeDefined();
        expect(deLorca!.online).toBe(true);
        expect(deLorca!.disponibilidad).toBe('libre');
    });

    it('el estado es retenido: quien llega despues lo recibe', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);
        await esperar(100);

        const recibidos: EstadoSede[] = [];
        const tarde = nuevo('murcia', 'Murcia');
        tarde.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(tarde);
        await esperar(100);

        expect(recibidos.some(e => e.sede === 'lorca' && e.online)).toBe(true);
    });

    it('el LWT marca offline cuando el cliente muere de golpe', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(canarias);
        await esperar(100);

        lorca.matarConexionParaTest();
        await esperar(300);

        const ultimo = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(ultimo!.online).toBe(false);
    });

    it('tras una desconexion limpia el estado retenido queda offline', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(canarias);
        await esperar(100);

        await lorca.desconectar();
        await esperar(150);

        const ultimo = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(ultimo!.online).toBe(false);
    });

    it('entrega una invitacion solo a su destinatario', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        const murcia = nuevo('murcia', 'Murcia');
        const canarias = nuevo('canarias', 'Gran Canaria');

        const enMurcia: string[] = [];
        const enCanarias: string[] = [];
        murcia.alRecibirInvitacion(i => enMurcia.push(i.callId));
        canarias.alRecibirInvitacion(i => enCanarias.push(i.callId));

        await Promise.all([
            conectarYEsperar(lorca), conectarYEsperar(murcia), conectarYEsperar(canarias)
        ]);

        await lorca.publicarInvitacion('murcia', {
            callId: 'c1', sala: 'spm-c1', origen: 'lorca',
            invitados: ['murcia'], ts: new Date().toISOString()
        });
        await esperar(150);

        expect(enMurcia).toEqual(['c1']);
        expect(enCanarias).toEqual([]);
    });

    it('publica disponibilidad ocupado con el callId', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(canarias);
        await esperar(100);

        await lorca.publicarEstado('ocupado', 'c9');
        await esperar(150);

        const ultimo = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(ultimo!.disponibilidad).toBe('ocupado');
        expect(ultimo!.callId).toBe('c9');
    });

    it('las invitaciones NO son retenidas: no resucitan para quien llega despues', async () => {
        // La mitad no probada del contrato de retencion. Una invitacion retenida
        // haria sonar un kiosco al reconectar por una llamada terminada hace una hora.
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);
        await lorca.publicarInvitacion('murcia', {
            callId: 'c-vieja', sala: 'spm-c-vieja', origen: 'lorca',
            invitados: ['murcia'], ts: new Date().toISOString()
        });
        await esperar(150);

        const murcia = nuevo('murcia', 'Murcia');
        const recibidas: string[] = [];
        murcia.alRecibirInvitacion(i => recibidas.push(i.callId));
        await conectarYEsperar(murcia);
        await esperar(250);

        expect(recibidas).toEqual([]);
    });

    it('tampoco son retenidos los eventos de llamada', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await conectarYEsperar(lorca);
        await lorca.publicarEventoLlamada('c-vieja', 'cuelga');
        await esperar(150);

        const murcia = nuevo('murcia', 'Murcia');
        const recibidos: string[] = [];
        murcia.alRecibirEventoLlamada(e => recibidos.push(e.tipo));
        await conectarYEsperar(murcia);
        await esperar(250);

        expect(recibidos).toEqual([]);
    });
});

describe('ClienteMqtt: reconexion', () => {
    let broker: BrokerDePrueba;
    const clientes: ClienteMqtt[] = [];

    const nuevo = (sede: string, nombre: string) => {
        const c = new ClienteMqtt({ url: broker.url, sede, nombre });
        clientes.push(c);
        return c;
    };

    beforeEach(async () => { broker = await arrancarBroker(); });
    afterEach(async () => {
        await Promise.all(clientes.splice(0).map(c => c.desconectar()));
        await broker.parar();
    });

    it('tras caer y volver el broker se resuscribe y republica su presencia', async () => {
        // El fallo original: la secuencia de enganche estaba en un `once('connect')`.
        // mqtt.js reconectaba por debajo, pero el totem no volvia a suscribirse ni a
        // publicar `online: true`: pantalla de "Sin conexion" para siempre y sede
        // gris y no pulsable en las demas. Levantar el broker en el MISMO puerto es
        // la forma realista de reproducirlo.
        const lorca = nuevo('lorca', 'Lorca');
        const uniones = espiaUniones(lorca);
        await lorca.conectar();
        await uniones.hasta(1);

        const { puerto, puertoWs } = broker;
        await broker.parar();
        await esperar(200);
        broker = await arrancarBroker({ puerto, puertoWs });

        // 1. `alConectar` vuelve a dispararse: la maquina de estados sale de sin-conexion.
        await uniones.hasta(2);
        expect(uniones.total).toBeGreaterThanOrEqual(2);

        // 2. Republica `online: true` sobre un broker que arranco con la
        //    persistencia vacia: sin esto la sede quedaria gris para las demas.
        const canarias = nuevo('canarias', 'Gran Canaria');
        const recibidos: EstadoSede[] = [];
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(canarias);
        await esperar(250);
        const deLorca = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(deLorca).toBeDefined();
        expect(deLorca!.online).toBe(true);

        // 3. Y vuelve a estar suscrito: una invitacion nueva le llega.
        const recibidas: string[] = [];
        lorca.alRecibirInvitacion(i => recibidas.push(i.callId));
        await canarias.publicarInvitacion('lorca', {
            callId: 'c-tras-reconexion', sala: 'spm-c', origen: 'canarias',
            invitados: ['lorca'], ts: new Date().toISOString()
        });
        await esperar(300);
        expect(recibidas).toEqual(['c-tras-reconexion']);
    }, 30_000);

    it('un broker caido al arrancar no rompe conectar() ni deja al cliente sordo', async () => {
        // Antes, el `once('error')` rechazaba una promesa que main.ts consumia con
        // `void`: unhandled rejection, y el cliente no llegaba a suscribirse nunca.
        const { puerto, puertoWs } = broker;
        await broker.parar();

        const lorca = new ClienteMqtt({ url: `mqtt://127.0.0.1:${puerto}`, sede: 'lorca', nombre: 'Lorca' });
        clientes.push(lorca);
        const uniones = espiaUniones(lorca);

        await expect(lorca.conectar()).resolves.toBeUndefined();
        expect(uniones.total).toBe(0);

        // Cuando el broker aparece, el totem se engancha solo.
        broker = await arrancarBroker({ puerto, puertoWs });
        await uniones.hasta(1);
        expect(uniones.total).toBe(1);
    }, 30_000);
});

describe('ClienteMqtt: payloads invalidos', () => {
    let broker: BrokerDePrueba;
    const clientes: ClienteMqtt[] = [];

    const nuevo = (sede: string, nombre: string) => {
        const c = new ClienteMqtt({ url: broker.url, sede, nombre });
        clientes.push(c);
        return c;
    };

    const publicarCrudo = async (topic: string, payload: string, retain = false) => {
        const bruto = await mqtt.connectAsync(broker.url);
        await bruto.publishAsync(topic, payload, { qos: 1, retain });
        await bruto.endAsync();
    };

    beforeEach(async () => { broker = await arrancarBroker(); });
    afterEach(async () => {
        await Promise.all(clientes.splice(0).map(c => c.desconectar()));
        await broker.parar();
    });

    it('un payload que no es JSON se descarta y se registra', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        const recibidos: EstadoSede[] = [];
        lorca.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(lorca);

        const traza = vi.spyOn(console, 'error').mockImplementation(() => {});
        await publicarCrudo('totem/murcia/estado', '{esto no es json', true);
        await esperar(200);

        expect(recibidos.filter(e => e.sede === 'murcia')).toEqual([]);
        expect(traza).toHaveBeenCalled();
        traza.mockRestore();
    });

    it('un estado sin el campo sede se descarta en vez de castearse a ciegas', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        const recibidos: EstadoSede[] = [];
        lorca.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(lorca);

        const traza = vi.spyOn(console, 'error').mockImplementation(() => {});
        await publicarCrudo('totem/murcia/estado', JSON.stringify({ online: true }), true);
        await esperar(200);

        expect(recibidos.filter(e => e.sede === 'murcia')).toEqual([]);
        expect(traza).toHaveBeenCalled();
        traza.mockRestore();
    });

    it('un evento de llamada con un tipo desconocido se descarta', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        const recibidos: string[] = [];
        lorca.alRecibirEventoLlamada(e => recibidos.push(e.tipo));
        await conectarYEsperar(lorca);

        const traza = vi.spyOn(console, 'error').mockImplementation(() => {});
        await publicarCrudo('llamada/c1/evento',
            JSON.stringify({ callId: 'c1', sede: 'murcia', tipo: 'explota' }));
        await esperar(200);

        expect(recibidos).toEqual([]);
        expect(traza).toHaveBeenCalled();
        traza.mockRestore();
    });

    it('un estado con campos ausentes se completa con valores seguros', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        const recibidos: EstadoSede[] = [];
        lorca.alCambiarEstadoSede(e => recibidos.push(e));
        await conectarYEsperar(lorca);

        await publicarCrudo('totem/murcia/estado', JSON.stringify({ sede: 'murcia' }), true);
        await esperar(200);

        const deMurcia = recibidos.find(e => e.sede === 'murcia');
        expect(deMurcia).toEqual({
            sede: 'murcia', nombre: 'murcia', online: false,
            disponibilidad: 'libre', callId: null, ts: ''
        });
    });

    it('recibe el directorio de sedes retenido', async () => {
        await publicarCrudo(TOPIC_CONFIG_SEDES, JSON.stringify({
            ts: '2026-07-30T10:00:00Z',
            sedes: [
                { id: 'lorca', nombre: 'Lorca', orden: 1 },
                { id: 'murcia', nombre: 'Murcia', orden: 3 }
            ]
        }), true);

        const lorca = nuevo('lorca', 'Lorca');
        let directorio: Sede[] = [];
        lorca.alRecibirDirectorio(s => { directorio = s; });
        await conectarYEsperar(lorca);
        await esperar(200);

        expect(directorio).toEqual([
            { id: 'lorca', nombre: 'Lorca', orden: 1 },
            { id: 'murcia', nombre: 'Murcia', orden: 3 }
        ]);
    });

    it('un directorio con entradas invalidas conserva solo las buenas', async () => {
        await publicarCrudo(TOPIC_CONFIG_SEDES, JSON.stringify({
            sedes: [{ nombre: 'sin id' }, { id: 'murcia' }, 'basura']
        }), true);

        const lorca = nuevo('lorca', 'Lorca');
        let directorio: Sede[] = [];
        lorca.alRecibirDirectorio(s => { directorio = s; });
        await conectarYEsperar(lorca);
        await esperar(200);

        expect(directorio).toEqual([
            { id: 'murcia', nombre: 'murcia', orden: Number.MAX_SAFE_INTEGER }
        ]);
    });
});

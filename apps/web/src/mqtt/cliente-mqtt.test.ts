import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { arrancarBroker, type BrokerDePrueba } from './broker-de-prueba';
import { ClienteMqtt } from './cliente-mqtt';
import type { EstadoSede } from '../core/tipos';

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('ClienteMqtt', () => {
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

    it('publica su presencia al conectar', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await lorca.conectar();

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await canarias.conectar();
        await esperar(100);

        const deLorca = recibidos.find(e => e.sede === 'lorca');
        expect(deLorca).toBeDefined();
        expect(deLorca!.online).toBe(true);
        expect(deLorca!.disponibilidad).toBe('libre');
    });

    it('el estado es retenido: quien llega despues lo recibe', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await lorca.conectar();
        await esperar(100);

        const recibidos: EstadoSede[] = [];
        const tarde = nuevo('murcia', 'Murcia');
        tarde.alCambiarEstadoSede(e => recibidos.push(e));
        await tarde.conectar();
        await esperar(100);

        expect(recibidos.some(e => e.sede === 'lorca' && e.online)).toBe(true);
    });

    it('el LWT marca offline cuando el cliente muere de golpe', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await lorca.conectar();

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await canarias.conectar();
        await esperar(100);

        lorca.matarConexionParaTest();
        await esperar(300);

        const ultimo = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(ultimo!.online).toBe(false);
    });

    it('tras una desconexion limpia el estado retenido queda offline', async () => {
        const lorca = nuevo('lorca', 'Lorca');
        await lorca.conectar();

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await canarias.conectar();
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

        await Promise.all([lorca.conectar(), murcia.conectar(), canarias.conectar()]);
        await esperar(100);

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
        await lorca.conectar();

        const recibidos: EstadoSede[] = [];
        const canarias = nuevo('canarias', 'Gran Canaria');
        canarias.alCambiarEstadoSede(e => recibidos.push(e));
        await canarias.conectar();
        await esperar(100);

        await lorca.publicarEstado('ocupado', 'c9');
        await esperar(150);

        const ultimo = recibidos.filter(e => e.sede === 'lorca').at(-1);
        expect(ultimo!.disponibilidad).toBe('ocupado');
        expect(ultimo!.callId).toBe('c9');
    });
});

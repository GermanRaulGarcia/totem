import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mqtt from 'mqtt';
import { arrancarBroker, type BrokerDePrueba } from '../mqtt/broker-de-prueba';
import { ClienteMqtt } from '../mqtt/cliente-mqtt';
import { TOPIC_CONFIG_SEDES } from '../mqtt/topics';
import { SesionJitsi, type ApiJitsi } from '../jitsi/sesion-jitsi';
import { fijarGeneradorCallId } from '../core/maquina-estados';
import type { NombreTimer } from '../core/tipos';
import type { Sonidos, Temporizadores } from './interprete';
import { Totem } from './totem';

/**
 * La prueba que le faltaba a la suite: DOS totems reales hablando por un broker
 * real, en proceso. Los seis fallos criticos de la primera revision vivian entre
 * modulos -MQTT, maquina de estados, interprete, Jitsi- con 71 tests unitarios en
 * verde. Cada modulo era correcto; el pegamento no lo probaba nadie.
 */

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Sondea hasta que la condicion se cumple, para no depender de sleeps a ojo. */
async function hasta(condicion: () => boolean, ms = 8_000): Promise<void> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
        if (condicion()) return;
        await esperar(20);
    }
    throw new Error('la condicion no se cumplio a tiempo');
}

interface Registro {
    creados: string[];
    destruidos: number;
    contenedores: Array<HTMLElement | null>;
}

/** Doble de Jitsi que ademas anota EN QUE nodo se le pidio montar el iframe. */
function jitsiDeMentira(registro: Registro, contenedor: HTMLElement) {
    const fabrica = (sala: string, padre: HTMLElement): ApiJitsi => {
        registro.creados.push(sala);
        registro.contenedores.push(padre);
        return {
            executeCommand: vi.fn(),
            addEventListener: vi.fn(),
            dispose: () => { registro.destruidos++; },
            isAudioMuted: async () => false
        };
    };
    return new SesionJitsi(fabrica, () => contenedor, 'doble');
}

function temporizadoresReales(): Temporizadores {
    const activos = new Map<NombreTimer, ReturnType<typeof setTimeout>>();
    return {
        arrancar(nombre, ms, cb) {
            const previo = activos.get(nombre);
            if (previo !== undefined) clearTimeout(previo);
            activos.set(nombre, setTimeout(cb, ms));
        },
        cancelar(nombre) {
            const id = activos.get(nombre);
            if (id !== undefined) { clearTimeout(id); activos.delete(nombre); }
        }
    };
}

const sonidosMudos = (): Sonidos => ({
    sonarTimbre: vi.fn(), pararTimbre: vi.fn(),
    sonarRingback: vi.fn(), pararRingback: vi.fn()
});

interface Montaje {
    totem: Totem;
    mqtt: ClienteMqtt;
    registro: Registro;
    timers: Temporizadores;
}

describe('integracion: dos sedes contra un broker real', () => {
    let broker: BrokerDePrueba;
    const montajes: Montaje[] = [];

    function montar(sede: string, nombre: string, contenedor: HTMLElement): Montaje {
        const mqtt = new ClienteMqtt({ url: broker.url, sede, nombre });
        const registro: Registro = { creados: [], destruidos: 0, contenedores: [] };
        const timers = temporizadoresReales();
        const totem = new Totem({
            mqtt,
            jitsi: jitsiDeMentira(registro, contenedor),
            sonidos: sonidosMudos(),
            timers,
            sede
        });
        const montaje = { totem, mqtt, registro, timers };
        montajes.push(montaje);
        return montaje;
    }

    beforeEach(async () => {
        broker = await arrancarBroker();
        let n = 0;
        fijarGeneradorCallId(() => `call-${++n}`);
    });

    afterEach(async () => {
        await Promise.all(montajes.splice(0).map(m => m.totem.parar()));
        await broker.parar();
    });

    it('llamada completa con cuelgue REMOTO: ambos lados sueltan su sesion', async () => {
        // El contenedor de video de cada sede, equivalente al `#jitsi` de la UI.
        const panelLorca = { } as HTMLElement;
        const panelMurcia = { } as HTMLElement;
        const lorca = montar('lorca', 'Lorca', panelLorca);
        const murcia = montar('murcia', 'Murcia', panelMurcia);

        lorca.totem.arrancar();
        murcia.totem.arrancar();
        await hasta(() => lorca.totem.contexto.estado === 'inactivo'
            && murcia.totem.contexto.estado === 'inactivo');

        // Se ven mutuamente disponibles.
        await hasta(() => lorca.totem.sedes().some(s => s.sede === 'murcia' && s.online));

        // Lorca llama a Murcia.
        lorca.totem.emitir({ tipo: 'toque-pantalla' });
        lorca.totem.alternarSeleccion('murcia');
        lorca.totem.emitir({ tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        expect(lorca.totem.contexto.estado).toBe('llamando');
        expect(lorca.registro.creados).toEqual([]); // Nada de iframe mientras suena.

        // Murcia suena y acepta.
        await hasta(() => murcia.totem.contexto.estado === 'recibiendo');
        murcia.totem.emitir({ tipo: 'aceptar' });

        // Los dos entran en la llamada, cada uno con UN iframe en SU contenedor.
        await hasta(() => lorca.totem.contexto.estado === 'en-llamada');
        expect(murcia.totem.contexto.estado).toBe('en-llamada');
        await murcia.totem.efectosAplicados();
        await lorca.totem.efectosAplicados();
        expect(lorca.registro.creados).toEqual(['spm-call-1']);
        expect(murcia.registro.creados).toEqual(['spm-call-1']);
        expect(lorca.registro.contenedores).toEqual([panelLorca]);
        expect(murcia.registro.contenedores).toEqual([panelMurcia]);

        // Murcia cuelga. Lorca se queda SOLA: tiene que soltar el iframe.
        // Esta es la mitad que nunca se construyo, y el fallo fundacional del
        // sistema antiguo (un totem solo en una sala, para siempre).
        murcia.totem.emitir({ tipo: 'colgar' });
        await hasta(() => lorca.totem.contexto.estado === 'inactivo');
        await hasta(() => murcia.totem.contexto.estado === 'inactivo');

        expect(lorca.registro.destruidos).toBe(1);
        expect(murcia.registro.destruidos).toBe(1);
        expect(lorca.registro.creados).toHaveLength(1);
        expect(murcia.registro.creados).toHaveLength(1);
    }, 30_000);

    it('un rechazo corta la llamada del que llama sin esperar los 45 s', async () => {
        const lorca = montar('lorca', 'Lorca', { } as HTMLElement);
        const murcia = montar('murcia', 'Murcia', { } as HTMLElement);
        lorca.totem.arrancar();
        murcia.totem.arrancar();
        await hasta(() => lorca.totem.contexto.estado === 'inactivo'
            && murcia.totem.contexto.estado === 'inactivo');

        lorca.totem.emitir({ tipo: 'toque-pantalla' });
        lorca.totem.emitir({ tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        await hasta(() => murcia.totem.contexto.estado === 'recibiendo');

        murcia.totem.emitir({ tipo: 'rechazar' });
        await hasta(() => lorca.totem.contexto.estado === 'inactivo');
        expect(lorca.registro.creados).toEqual([]);
    }, 30_000);

    it('un evento de OTRA llamada no toca la llamada propia', async () => {
        const lorca = montar('lorca', 'Lorca', { } as HTMLElement);
        const murcia = montar('murcia', 'Murcia', { } as HTMLElement);
        lorca.totem.arrancar();
        murcia.totem.arrancar();
        await hasta(() => lorca.totem.contexto.estado === 'inactivo'
            && murcia.totem.contexto.estado === 'inactivo');

        lorca.totem.emitir({ tipo: 'toque-pantalla' });
        lorca.totem.emitir({ tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        await hasta(() => murcia.totem.contexto.estado === 'recibiendo');
        murcia.totem.emitir({ tipo: 'aceptar' });
        await hasta(() => lorca.totem.contexto.estado === 'en-llamada');

        // Todos escuchan `llamada/+/evento`. Un cuelgue de una llamada ajena en
        // curso llegaria tambien aqui; sin el filtro por callId cortaria esta.
        await murcia.mqtt.publicarEventoLlamada('call-ajena', 'cuelga');
        await esperar(400);
        expect(lorca.totem.contexto.estado).toBe('en-llamada');
        expect(lorca.registro.destruidos).toBe(0);
    }, 30_000);

    it('el broker cae y vuelve estando en reposo: ambos recuperan y republican', async () => {
        const lorca = montar('lorca', 'Lorca', { } as HTMLElement);
        const murcia = montar('murcia', 'Murcia', { } as HTMLElement);
        lorca.totem.arrancar();
        murcia.totem.arrancar();
        await hasta(() => lorca.totem.contexto.estado === 'inactivo'
            && murcia.totem.contexto.estado === 'inactivo');
        await hasta(() => lorca.totem.sedes().some(s => s.sede === 'murcia' && s.online));

        const { puerto, puertoWs } = broker;
        await broker.parar();

        // La caida se ve en pantalla: es el unico estado honesto.
        await hasta(() => lorca.totem.contexto.estado === 'sin-conexion'
            && murcia.totem.contexto.estado === 'sin-conexion');

        broker = await arrancarBroker({ puerto, puertoWs });

        // Y al volver, los dos salen de sin-conexion...
        await hasta(() => lorca.totem.contexto.estado === 'inactivo'
            && murcia.totem.contexto.estado === 'inactivo');

        // ...y vuelven a verse online. Sin republicar `online: true` sobre el broker
        // recien arrancado, las tarjetas quedarian grises y no pulsables para siempre.
        await hasta(() => lorca.totem.sedes().some(s => s.sede === 'murcia' && s.online));
        await hasta(() => murcia.totem.sedes().some(s => s.sede === 'lorca' && s.online));

        // Y la senalizacion sigue funcionando de verdad: se puede volver a llamar.
        lorca.totem.emitir({ tipo: 'toque-pantalla' });
        lorca.totem.emitir({ tipo: 'seleccion-confirmada', destinos: ['murcia'] });
        await hasta(() => murcia.totem.contexto.estado === 'recibiendo');
    }, 40_000);

    it('el directorio retenido hace visible una sede que nunca ha conectado', async () => {
        // Diseno §9.2: "instalar Murcia no requiere tocar Lorca ni Canarias". Sin
        // consumir config/sedes, una sede que aun no ha arrancado es invisible.
        const operaciones = await mqtt.connectAsync(broker.url);
        await operaciones.publishAsync(TOPIC_CONFIG_SEDES, JSON.stringify({
            ts: '2026-07-30T10:00:00Z',
            sedes: [
                { id: 'lorca', nombre: 'Lorca', orden: 1 },
                { id: 'canarias', nombre: 'Gran Canaria', orden: 2 },
                { id: 'murcia', nombre: 'Murcia', orden: 3 }
            ]
        }), { qos: 1, retain: true });
        await operaciones.endAsync();

        const lorca = montar('lorca', 'Lorca', { } as HTMLElement);
        lorca.totem.arrancar();
        await hasta(() => lorca.totem.contexto.estado === 'inactivo');
        await hasta(() => lorca.totem.sedes().length === 2);

        // Aparecen las otras dos, en el orden del directorio y marcadas offline.
        // La propia sede nunca se pinta a si misma.
        expect(lorca.totem.sedes().map(s => [s.sede, s.nombre, s.online])).toEqual([
            ['canarias', 'Gran Canaria', false],
            ['murcia', 'Murcia', false]
        ]);

        // Y cuando Murcia arranca de verdad, la presencia en vivo pisa al directorio.
        const murcia = montar('murcia', 'Murcia', { } as HTMLElement);
        murcia.totem.arrancar();
        await hasta(() => lorca.totem.sedes().some(s => s.sede === 'murcia' && s.online));
        expect(lorca.totem.sedes()).toHaveLength(2);
    }, 30_000);
});

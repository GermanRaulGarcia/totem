// Broker MQTT para probar el totem a mano, sin Docker y sin VPS.
//
// Es el mismo aedes que usan las pruebas (`src/mqtt/broker-de-prueba.ts`), pero
// con tres diferencias pensadas para uso manual:
//   1. Puertos FIJOS, para poder escribirlos en la URL del kiosco.
//   2. Escucha en 0.0.0.0 y no solo en 127.0.0.1, para que otras maquinas de la
//      red puedan conectarse. El de pruebas no debe hacerlo; este si.
//   3. Publica `config/sedes` retenido al arrancar, que es lo que hace que las
//      sedes aparezcan en pantalla antes de haberse conectado nunca.
//
// SIN AUTENTICACION: aedes sin manejador `authenticate` acepta a cualquiera.
// Vale para una prueba en red local y NO vale para produccion, donde Mosquitto
// va con `allow_anonymous false` y una credencial por sede (ver infra/README.md).

import { Aedes } from 'aedes';
import { createServer as crearTcp } from 'node:net';
import { createServer as crearHttp } from 'node:http';
import { WebSocketServer, createWebSocketStream } from 'ws';

const PUERTO_TCP = Number(process.env.PUERTO_TCP ?? 1883);
const PUERTO_WS = Number(process.env.PUERTO_WS ?? 9001);

// `zona` es IANA y no un desfase en horas: asi el cambio de hora lo resuelve el
// navegador. Canarias va una hora por detras de la peninsula todo el año.
const SEDES = [
    { id: 'lorca', nombre: 'Lorca', orden: 1, zona: 'Europe/Madrid' },
    { id: 'canarias', nombre: 'Gran Canaria', orden: 2, zona: 'Atlantic/Canary' },
    { id: 'murcia', nombre: 'Murcia', orden: 3, zona: 'Europe/Madrid' }
];

const aedes = await Aedes.createBroker();

const tcp = crearTcp(socket => aedes.handle(socket));
const http = crearHttp();
const wss = new WebSocketServer({ server: http });
wss.on('connection', socket => {
    aedes.handle(createWebSocketStream(socket), socket);
});

// Un EADDRINUSE aqui sale por defecto como un volcado de pila de Node, y el
// motivo real casi siempre es el mismo y es inofensivo: ya hay un broker
// corriendo en otra terminal. Merece un mensaje y no un susto.
function escuchar(servidor, puerto, que) {
    return new Promise((resolve, reject) => {
        servidor.once('error', error => {
            if (error.code !== 'EADDRINUSE') return reject(error);
            console.error(`\nEl puerto ${puerto} (${que}) ya esta ocupado.`);
            console.error('Lo normal es que ya tengas este mismo broker corriendo en otra');
            console.error('terminal: busca la ventana con el cartel de arranque y usa esa.');
            console.error(`\nSi no la encuentras:   lsof -nP -iTCP:${puerto} -sTCP:LISTEN`);
            console.error(`Y para usar otros puertos:   PUERTO_TCP=1884 PUERTO_WS=9002 node scripts/broker-local.mjs\n`);
            process.exit(1);
        });
        servidor.listen(puerto, '0.0.0.0', resolve);
    });
}

await escuchar(tcp, PUERTO_TCP, 'TCP');
await escuchar(http, PUERTO_WS, 'WebSocket');

// Retenido: sin el flag, un totem que arranque despues no recibe el directorio
// y no sabe que sedes existen. Es el mismo `-r` del infra/README.md.
await new Promise(resolve => aedes.publish({
    topic: 'config/sedes',
    payload: JSON.stringify({ ts: new Date().toISOString(), sedes: SEDES }),
    qos: 1,
    retain: true
}, resolve));

// Traza minima: en una prueba manual, saber quien entra y quien se cae es la
// diferencia entre depurar y adivinar.
aedes.on('client', c => console.log('  + conectado    ', c.id));
aedes.on('clientDisconnect', c => console.log('  - desconectado ', c.id));
aedes.on('publish', (paquete, cliente) => {
    if (cliente === null) return; // mensajes internos del propio broker
    console.log(`    ${paquete.topic}  ${paquete.payload.toString().slice(0, 120)}`);
});

console.log('\nBroker MQTT de pruebas en marcha');
console.log(`  WebSocket (navegador)  ws://localhost:${PUERTO_WS}`);
console.log(`  TCP (mosquitto_sub)    mqtt://localhost:${PUERTO_TCP}`);
console.log(`  Directorio publicado   ${SEDES.map(s => s.id).join(', ')}`);
console.log('\nCtrl+C para parar.\n');

process.on('SIGINT', async () => {
    console.log('\nParando...');
    for (const socket of wss.clients) socket.terminate();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    await new Promise(resolve => tcp.close(resolve));
    await new Promise(resolve => aedes.close(resolve));
    process.exit(0);
});

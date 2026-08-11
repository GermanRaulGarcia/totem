# Tótem SPM

Interfono por vídeo entre las oficinas de **Lorca**, **Gran Canaria** y **Murcia**.
Cada sede tiene un panel táctil colgado en la pared que sirve para llamar a las
otras y para recibir sus llamadas.

> 👋 **¿Acabas de coger este proyecto?** Empieza por **[`docs/ESTADO.md`](docs/ESTADO.md)**:
> dónde estamos, qué hay pendiente, qué fallos ya están identificados y qué
> decisiones no conviene reabrir. Este README explica cómo funciona el sistema;
> ese documento explica qué hacer a continuación.

> ⚠️ **En este repositorio conviven DOS sistemas.** No son versiones del mismo
> código: son dos programas distintos, y uno de ellos está en producción ahora
> mismo. Antes de tocar nada, lee la tabla siguiente.

| | `files/index.html` | `apps/web/` |
|---|---|---|
| Qué es | Sistema **antiguo**, en producción | Sistema **nuevo**, lo reemplaza |
| Dónde corre | En los 3 PCs, como fichero local | Servido por HTTPS desde el VPS |
| Cómo se lanza | `files/PORTAL.lnk` (Chrome en kiosco sobre `file://`) | URL en Chrome en kiosco |
| Jitsi | Una sala **abierta 24/7** con los 3 tótems dentro | Sala efímera, solo mientras dura la llamada |
| Estado | Congelado. Solo parches urgentes de producción | En desarrollo |

**No edites `files/index.html` salvo que estés aplicando un parche urgente a
producción.** Es una sola página de 152 líneas, sin build ni pruebas, copiada a
mano a cada máquina por AnyDesk. Mantener los tres tótems dentro de una
conferencia permanente es la causa raíz de los cuelgues: es justo lo que
`apps/web` existe para eliminar.

Cuando `apps/web` se despliegue en las tres sedes, `files/` desaparece.

---

## Por qué existe el rediseño

El sistema antiguo mantiene una sesión WebRTC viva en una pestaña de Chrome
durante semanas. El proceso crece hasta que el compositor se atasca; no hay
detección de reconexión ni watchdog, y nadie se entera hasta que alguien toca la
campana y no pasa nada. Además no existe el concepto de "llamada": no se puede
elegir a qué sede llamar.

El sistema nuevo separa las dos cosas que el antiguo confundía:

- **Presencia y señalización** viajan por MQTT (Mosquitto, en un VPS propio). En
  reposo eso es un WebSocket dormido: sin media, sin decodificación, sin Jitsi
  cargado.
- **El vídeo** viaja por Jitsi, y el iframe se crea al entrar en la llamada y se
  destruye al colgar.

La consecuencia buscada: en reposo el tótem no ejecuta prácticamente nada, y una
caída del broker no corta una conversación en curso.

---

## Cómo está montado `apps/web`

```
src/core/maquina-estados.ts   La FSM. PURA: sin red, sin DOM, sin timers.
src/core/tipos.ts             Estados, eventos y efectos del dominio.
src/runtime/interprete.ts     Ejecuta los efectos (datos inertes) contra el mundo.
src/runtime/totem.ts          El cableado: MQTT -> FSM -> intérprete.
src/mqtt/                     Cliente MQTT, topics y un broker en proceso para tests.
src/jitsi/sesion-jitsi.ts     Único punto donde nace y muere el iframe.
src/ui/                       Las pantallas y la hoja de estilos.
src/main.ts                   Arranque en el navegador: URL, DOM y sonidos.
```

La regla que sostiene el diseño: **la máquina de estados no tiene efectos
secundarios**. Devuelve una lista de efectos como datos, y otro módulo los
ejecuta. Por eso se puede probar entera en milisegundos, y por eso el intérprete
puede serializarlos sin que ella se entere.

Si vas a tocar `maquina-estados.ts`: no importes `mqtt`, ni Jitsi, ni `document`,
ni uses temporizadores. Un temporizador es el efecto `arrancar-timer`.

---

## Lanzar un tótem

Chrome en modo kiosco, en cada PC, con la credencial MQTT **propia de esa sede**:

```
chrome.exe --kiosk ^
  "https://interfono.kordino.com/?sede=lorca&nombre=Lorca&usuario=totem-lorca&contrasena=CONTRASENA_LORCA" ^
  --autoplay-policy=no-user-gesture-required ^
  --no-first-run ^
  --disable-session-crashed-bubble
```

| Parámetro | Obligatorio | Para qué |
|---|---|---|
| `sede` | Sí | Id de la sede. Forma sus topics MQTT. Sin `/`, `+` ni `#` |
| `nombre` | Recomendado | Nombre visible en las otras pantallas |
| `usuario`, `contrasena` | Sí | Credencial MQTT de esta sede |
| `broker` | No | URL del broker. Por defecto `wss://{host}/mqtt` |
| `jitsi` | No | Host de Jitsi. Por defecto `meet.sunube.net` |

**Cada sede usa su propia credencial, nunca una compartida.** Las ACLs de
Mosquitto permiten a cada sede publicar solo su propio estado, de modo que una
sede comprometida no puede falsificar la presencia de otra. Con una credencial
común esa garantía desaparece por completo.

Que la contraseña viaje en la URL es deliberado y está razonado en `src/main.ts`:
quien pueda leerla ya tiene acceso físico a ese tótem.

---

## Desarrollo

Desde `apps/web`:

```bash
npm ci
npm run dev            # servidor de desarrollo de Vite
npm test               # unitarios + integración (vitest)
npm run test:watch
npx tsc --noEmit       # comprobación de tipos
npx playwright test    # E2E: dos sedes, dos contextos de navegador
npm run build
```

Las pruebas no necesitan Docker ni red: el broker MQTT (`aedes`) se levanta
dentro del propio proceso de test, y Jitsi se sustituye por un doble.

`npm run dev` responde 404 a `/vendor/external_api.js` hasta que lo descargues;
el paso está en `infra/README.md`. Sin él la interfaz funciona, pero al entrar en
una llamada se emite `jitsi-fallo` y se vuelve a reposo.

### Cómo se prueba cada capa

| Qué | Dónde | Con qué |
|---|---|---|
| La máquina de estados entera | `src/core/maquina-estados.test.ts` | Nada. Es pura |
| Presencia, LWT y retención | `src/mqtt/cliente-mqtt.test.ts` | Broker `aedes` en proceso |
| El cableado entre módulos | `src/runtime/integracion.test.ts` | Dos tótems contra un broker real |
| La llamada de punta a punta | `e2e/llamada.spec.ts` | Playwright, dos contextos |

El test de integración es el importante: los fallos que más caro salen en este
sistema no viven dentro de un módulo, viven entre dos.

---

## Dónde está el resto

| Documento | Contenido |
|---|---|
| `docs/ESTADO.md` | **Empieza aquí.** Estado, siguientes pasos, fallos conocidos y decisiones cerradas |
| `docs/superpowers/specs/2026-07-30-totem-redesign-design.md` | El diseño: decisiones, contrato MQTT, FSM, seguridad, fases |
| `docs/superpowers/plans/2026-07-30-totem-fases-1-4.md` | Plan de implementación de las fases 1 a 4 |
| `infra/README.md` | Despliegue del VPS: Mosquitto, el `VirtualHost` de Apache, credenciales y directorio de sedes |
| `infra/mosquitto/acl` | Qué puede publicar y leer cada sede |

`info.md` contiene credenciales y **no se versiona** (ver `.gitignore`).

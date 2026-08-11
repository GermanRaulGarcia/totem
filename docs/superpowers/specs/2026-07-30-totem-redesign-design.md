# Rediseño del sistema de tótems SPM: de conferencia permanente a llamada bajo demanda

**Estado:** aprobado · **Fecha:** 2026-07-30 · **Revisado:** 2026-07-31 · **Sedes afectadas:** Canarias, Lorca, Murcia (pendiente de instalar)

El sistema actual mantiene los tótems dentro de una única videoconferencia de Jitsi abierta las 24 horas. Esa decisión es la causa directa de los cuelgues, del consumo permanente de CPU y ancho de banda, y de que sea imposible elegir a qué sede se llama. Este documento define el rediseño: presencia ligera mediante MQTT y videollamada creada solo mientras dura la llamada, con selección de la sede destino y una interfaz nueva pensada para panel táctil.

---

## Cambio de alcance del 2026-07-31: la llamada multi-sede se retira

> **Léase antes que nada si el historial de git resulta confuso.**
>
> La versión del 2026-07-30 de este documento especificaba **llamada multi-sede simultánea** como requisito de negocio, y así se construyó: se podían elegir varias sedes destino, sonaban todas a la vez, la pantalla `llamando` llevaba el estado en vivo de cada una y una tercera sede podía incorporarse a una llamada en curso.
>
> El **2026-07-31 negocio retiró ese requisito**: nunca habrá más de dos sedes en una llamada. En consecuencia el multi-sede se ha **eliminado por completo** del código, de los tipos, de las pruebas y de este documento — no se ha dejado desactivado. La razón es deliberada: código muerto con aspecto de vivo cuesta más que código que no existe, porque el siguiente lector no puede distinguir "esto está apagado" de "esto está roto".
>
> **Lo que NO cambió:** elegir *a qué* sede se llama. Con tres oficinas, Lorca sigue escogiendo entre Murcia y Canarias. Eso era el requisito original y sigue vigente. Lo retirado es únicamente *hacer sonar varias a la vez*.
>
> Por tanto, si en el historial de git aparece `destinos: string[]`, `estadosDestino`, `publicar-invitaciones` o el evento `se-une`, **no es una funcionalidad perdida que haya que restaurar**: es una decisión de negocio revertida a propósito.

---

## Resumen para quien tenga prisa

| Pregunta | Respuesta |
|---|---|
| ¿Qué problema resolvemos? | El tótem se cuelga, va lento y no permite elegir sede |
| ¿Cuál es la causa raíz? | Una sesión WebRTC viva 24/7 en una pestaña de Chrome |
| ¿Cuál es el cambio central? | Jitsi se carga al aceptar la llamada y se destruye al colgar |
| ¿Qué añadimos? | Un broker MQTT en VPS propio para presencia y señalización |
| ¿Cambiamos de hardware? | No. Los PCs actuales se quedan; se endurecen |
| ¿Qué necesitamos del proveedor de Jitsi? | Una sola cosa: autenticación JWT en las salas |
| ¿Qué es urgente? | Cerrar la sala abierta y arreglar el micro. Hoy están expuestos |

---

## 1. Situación actual

### 1.1 Cómo funciona hoy

Cada sede tiene un panel táctil Android que actúa **únicamente como monitor**. El sistema real corre en un PC con Windows conectado por HDMI, que arranca Chrome en modo kiosco mediante el acceso directo `files/PORTAL.lnk`:

```
chrome.exe --kiosk "file:///C:/Portal/index.html?id=Gran_Canaria"
           --use-fake-ui-for-media-stream
           --autoplay-policy=no-user-gesture-required
           --no-first-run
```

Toda la aplicación es un único fichero de 152 líneas: `files/index.html`.

En `files/index.html:89` está la decisión que define el sistema:

```js
roomName: "a",
```

No existe el concepto de "llamada". Los tres tótems están permanentemente dentro de la misma sala de Jitsi, con el micrófono silenciado. El botón de la campana solo reproduce un mp3 y quita el silencio. Es una línea abierta tipo interfono, no un sistema de llamadas.

### 1.2 Defectos confirmados

Verificados contra la [documentación oficial de la iframe API de Jitsi](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-commands/).

**El hallazgo principal: `muteAudio` no existe.** Los únicos comandos de audio de la iframe API son `toggleAudio`. No hay `muteAudio`, ni `unmuteAudio`, ni `setAudioMuted`.

| # | Defecto | Ubicación | Consecuencia real |
|---|---|---|---|
| 1 | `api.executeCommand('muteAudio')` no existe | `index.html:125` | El silenciado automático a los 5 minutos **nunca se ejecuta** |
| 2 | Mismo comando inexistente al entrar | `index.html:146` | No silencia. Solo funciona por `startWithAudioMuted: true` en la config |
| 3 | `toggleAudio` es una alternancia | `index.html:120` | Como (1) nunca ocurre, **el micro queda abierto de forma permanente**; la segunda pulsación de la campana lo cierra |
| 4 | El receptor también alterna | `index.html:141` | Una llamada entrante **silencia** a quien ya estaba abierto |
| 5 | Sala `"a"` sin autenticación | `index.html:89` | Cualquiera que abra `meet.sunube.net/a` accede al audio y vídeo en directo de las oficinas |
| 6 | `hangup` y `settings` en la barra | `index.html:99` | Botón de autodestrucción accesible en un panel público |
| 7 | `door-chime.mp3` no está en el repo | `index.html:73` | Vive suelto en `C:\Portal`. Si falta, el timbre es mudo y el error solo va a `console.error` |
| 8 | `external_api.js` se carga del servidor remoto | `index.html:7` | Si el servidor no responde al arrancar: pantalla negra |
| 9 | Reintento infinito sin límite | `index.html:108` | `setTimeout(window.onload, 2000)` sin tope ni aviso en pantalla |
| 10 | Sin `viewport`, `user-select` ni `touch-action` | `<head>` | Un long-press o un pinch accidental rompe el layout |
| 11 | `p2p: { enabled: false }` | `index.html:93` | Fuerza el bridge incluso con dos participantes: más latencia y más carga |
| 12 | Credenciales en texto plano | `info.md` | IDs y contraseñas de AnyDesk dentro del repositorio |

Los defectos 1 a 4 combinados explican los fallos intermitentes de audio que se atribuían a la red. No es la red.

### 1.3 Diagnóstico raíz

Chrome mantiene una sesión WebRTC activa durante semanas sin cerrarse nunca. Jitsi y Chromium tienen fugas de memoria conocidas en sesiones largas: el proceso crece hasta que el compositor se atasca. No hay watchdog, ni detección de reconexión, ni recuperación. Si el bridge se reinicia o cae la red, el iframe queda en estado zombi y **nadie se entera hasta que alguien toca la campana y no ocurre nada**.

> **Conclusión que condiciona todo el proyecto:** el problema es de software, no de hardware. Migrar a Raspberry Pi o a una app Android sin cambiar la arquitectura solo traslada el cuelgue a otra máquina.

---

## 2. Decisiones tomadas y por qué

| Decisión | Elección | Razón |
|---|---|---|
| Hardware | **Mantener los PCs actuales**, endurecidos | Son lo más potente disponible y ya están pagados. El fallo es de software |
| Raspberry Pi 5 | Descartada por ahora | Válida para 2 participantes; justa con 3 o más streams en Chromium. Se reconsiderará cuando muera un PC |
| App nativa Android en el panel | Descartada | WebView antiguo y WebRTC inestable en paneles comerciales; muchos sin Play Services. Alto riesgo, poca ganancia |
| Capa de presencia | **Mosquitto (MQTT) en VPS propio** | El VPS es máquina aparte con root propio: coste marginal cero e independencia del tercero |
| Alternativa descartada: Jitsi como bus de mensajes | Descartada | Conserva una sesión de navegador viva 24/7, que es justo lo que falla hoy |
| Alternativa descartada: Cloudflare Workers | Descartada | Buena opción, pero innecesaria teniendo VPS propio |
| Alternativa descartada: servicio en la máquina de Jitsi | Descartada | La gestiona un tercero: fricción en cada despliegue, y un fallo de Jitsi tumbaría también la presencia |
| Topología de llamada | **Estrictamente 1 a 1** *(revisado el 2026-07-31)* | Negocio retiró el multi-sede: nunca más de dos sedes en una llamada. Se mantiene elegir a qué sede se llama |
| Escalado a móvil / Teams | **Fuera de alcance** | Los paneles están en zona de trabajo y casi siempre hay alguien. YAGNI |
| Escenario de uso | Interfono interno entre personal | No hay acceso de clientes; permite una interfaz más densa |
| Frontend | Vite + TypeScript, SPA estática | Máquina de estados explícita frente al `let api = null` global actual |
| Distribución | **URL servida por HTTPS**, no `file://` | Publicar una vez actualiza las tres sedes. Se acaba el mantenimiento por AnyDesk |

### Restricción clave que explica varias decisiones

`meet.sunube.net` es propiedad de SPM **pero lo administra un tercero**. Cada cambio implica fricción y plazos. El diseño minimiza deliberadamente lo que se le pide: **una única petición en toda la vida del proyecto** (activar JWT). Todo lo demás se despliega desde el VPS propio.

---

## 3. Arquitectura objetivo

### 3.1 Componentes

| Componente | Ubicación | Responsabilidad | Qué NO hace |
|---|---|---|---|
| `totem-web` | Chrome kiosco de cada sede | Interfaz y máquina de estados | No transporta media ni gestiona presencia |
| `totem-broker` | Mosquitto en VPS propio | Presencia y señalización | No toca el media |
| `meet.sunube.net` | Servidor del tercero | Media de la llamada | No conoce el estado de las sedes |
| Caddy | Mismo VPS | Sirve la SPA con TLS y termina el WebSocket MQTT | — |

```
                    ┌──────────────────────────┐
                    │   VPS propio (SPM)       │
   ┌───────────────►│  Mosquitto  +  Caddy     │◄──────────────┐
   │   WSS/MQTT     │  presencia   SPA + TLS   │   WSS/MQTT    │
   │                └──────────────────────────┘               │
   │                                                           │
┌──┴───────────┐                                        ┌──────┴───────┐
│ Tótem Lorca  │                                        │ Tótem Murcia │
└──┬───────────┘                                        └──────┬───────┘
   │                                                           │
   │              ┌────────────────────────────┐               │
   └─────────────►│  meet.sunube.net (Jitsi)   │◄──────────────┘
     solo durante │  media WebRTC              │  solo durante
     la llamada   └────────────────────────────┘  la llamada
```

### 3.2 Principio de desacoplamiento

**La señalización y el media son independientes.** Si el broker cae en mitad de una conversación, la llamada no se corta: el vídeo viaja por Jitsi. Solo se pierde la presencia, y la interfaz lo indica. Hoy, cualquier incidencia se lleva todo por delante.

> ⚠️ **La cara oculta de este principio, detectada en revisión.** Si la llamada sobrevive a la caída del broker, el **reenganche tiene que republicar la disponibilidad verdadera**. La capa MQTT no puede publicar `libre` en cada CONNACK "porque acaba de conectar": eso deja el estado retenido mintiendo durante el resto de la conversación, y otra sede ve un tótem disponible que en realidad está hablando. La disponibilidad la decide la máquina de estados, que es la única que sabe si hay llamada en curso; la capa de transporte solo se suscribe y avisa. Ver §5.2, evento `broker-conectado`.

### 3.3 Ciclo de vida de Jitsi: el cambio que elimina los cuelgues

| Estado del tótem | Qué hay corriendo |
|---|---|
| En reposo | Un WebSocket dormido. **Sin media, sin decodificación, sin Jitsi cargado** |
| En llamada | El iframe de Jitsi, creado en ese momento |
| Al colgar | El iframe se destruye por completo |

Además, recarga completa de la página cada 6 horas **solo si el tótem está en reposo**, como higiene preventiva.

---

## 4. Contrato MQTT

Todos los mensajes son JSON UTF-8. Transporte WSS con TLS.

### 4.1 Topics

| Topic | Retained | QoS | Publica | Contenido |
|---|---|---|---|---|
| `totem/{sede}/estado` | **Sí** | 1 | La propia sede | Presencia y disponibilidad |
| `totem/{sede}/invitacion` | No | 1 | Cualquier sede | Timbre dirigido a esa sede |
| `llamada/{callId}/evento` | No | 1 | Participantes | Respuestas y colgar |
| `config/sedes` | **Sí** | 1 | Operaciones | Directorio de sedes |

### 4.2 Presencia: `totem/{sede}/estado`

```json
{
  "sede": "lorca",
  "nombre": "Lorca",
  "online": true,
  "disponibilidad": "libre",
  "callId": null,
  "ts": "2026-07-30T09:12:00Z"
}
```

`disponibilidad` admite `libre` u `ocupado`. Cuando vale `ocupado`, `callId` identifica la llamada en curso.

**Para qué sirve `callId` desde el 2026-07-31.** Ya no sirve para que una tercera sede se una: eso se retiró. Se sigue publicando por dos motivos vigentes:

1. Cada tótem filtra por `callId` los eventos de `llamada/+/evento` — llegan los de **todas** las llamadas, y sin ese filtro un `cuelga` ajeno cortaría la conversación propia.
2. La pantalla de reposo muestra "En llamada" en ámbar, y el selector convierte esa sede en **no pulsable**.

Ese segundo punto es ahora la protección principal contra un tercero: con llamadas 1 a 1, llamar a quien ya está hablando solo produciría 45 s de timbre que nadie va a contestar. De ahí que un `ocupado` mentiroso sea un defecto serio y no cosmético (ver el aviso de §3.2).

**Last Will and Testament.** Cada cliente registra al conectar:

```json
{ "sede": "lorca", "online": false, "disponibilidad": "libre", "callId": null }
```

Si en Murcia se va la luz o se corta la fibra, el broker detecta el socket muerto y **publica el `offline` por su cuenta**. Las demás sedes lo ven en segundos. Sin polling, sin heartbeats manuales, sin código de detección de caídas.

> ⚠️ **Detalle crítico que se pasa por alto con frecuencia:** el mensaje de LWT debe publicarse con `retained: true`. Si no, no sobrescribe el `online: true` que quedó retenido y la sede aparece viva indefinidamente.
>
> ⚠️ **Y su hermano gemelo, detectado durante la implementación:** el LWT solo cubre las caídas bruscas. Ante una desconexión ordenada, el cliente envía un `DISCONNECT` limpio y **el broker descarta el Will** — por eso, al cerrar, el tótem tiene que publicar él mismo su `online: false` retenido. Si no, un apagado normal deja la sede marcada como viva y además desactiva el mecanismo que debería corregirlo.

Gracias al flag *retained*, un tótem que arranca conoce el estado de todas las demás sedes en el primer milisegundo, sin preguntar a nadie.

### 4.3 Invitación: `totem/{sede}/invitacion`

```json
{
  "callId": "9f2c1a4e-...",
  "sala": "spm-9f2c1a4e-...",
  "origen": "lorca",
  "ts": "2026-07-30T09:12:03Z"
}
```

No retenida: una invitación caducada no debe resucitar cuando un tótem se reconecta.

El campo `invitados` desapareció el 2026-07-31 con el multi-sede. Con llamadas 1 a 1 no aportaba nada: el topic ya nombra al destinatario y `origen` nombra al llamante, así que la lista era el destinatario escrito por segunda vez. Un lector tolerante lo ignora si aparece en un payload antiguo — y como las invitaciones no son retenidas, no hay payloads antiguos que migrar.

### 4.4 Eventos de llamada: `llamada/{callId}/evento`

```json
{ "callId": "9f2c1a4e-...", "sede": "murcia", "tipo": "acepta", "ts": "..." }
```

`tipo` admite: `acepta`, `rechaza`, `sin-respuesta`, `cuelga`.

`se-une` existía para las incorporaciones a una llamada en curso y se retiró el 2026-07-31 junto con el multi-sede. Un evento de tipo desconocido se descarta con traza, así que un tótem sin actualizar que lo publicara no rompería nada.

### 4.5 Directorio de sedes: `config/sedes`

```json
{
  "sedes": [
    { "id": "lorca",    "nombre": "Lorca",       "orden": 1 },
    { "id": "canarias", "nombre": "Gran Canaria", "orden": 2 },
    { "id": "murcia",   "nombre": "Murcia",      "orden": 3 }
  ]
}
```

**Esto resuelve el crecimiento.** El día que se instale Murcia basta con publicar este mensaje retenido: aparece sola en las tres pantallas. **No hay que tocar ni Lorca ni Canarias.** Se acaba el parámetro `?id=` escrito a mano en el `.lnk` de cada máquina.

### 4.6 Control de acceso

Credencial propia por sede, nunca compartida. ACLs de Mosquitto para la sede `X`:

| Operación | Permitido | Prohibido |
|---|---|---|
| Publicar | `totem/X/estado`, `totem/+/invitacion`, `llamada/+/evento` | `totem/Y/estado` |
| Suscribir | `totem/+/estado`, `totem/X/invitacion`, `llamada/+/evento`, `config/sedes` | `totem/Y/invitacion` |

La garantía que aporta: **una sede no puede falsificar la presencia de otra ni leer sus invitaciones**. Los eventos de llamada sí son visibles entre sedes, lo cual es aceptable en una red interna de tres oficinas de confianza.

---

## 5. Máquina de estados

### 5.1 Por qué es el corazón del diseño

El defecto del `toggleAudio` existe precisamente **porque no hay estado**. `toggleAudio` es una operación ciega sobre un sistema cuyo estado nadie lleva. Con una máquina de estados nunca se alterna nada: se declara el estado destino y la máquina reconcilia. Ese defecto pasa a ser imposible de escribir.

### 5.2 Estados y transiciones

> ### Cambio del 2026-08-10: se retira la pantalla de selección
>
> El diseño original intercalaba un estado `seleccionando` entre reposo y la
> llamada: se tocaba la pantalla, se abría un selector con las mismas tarjetas de
> sede que ya se estaban viendo, se elegía una y se pulsaba Llamar. **Tres toques
> para una llamada, cuando el sistema al que sustituye la hace en uno.**
>
> La pantalla de reposo ya es un selector: muestra todas las sedes con su estado
> en vivo. Una segunda pantalla para elegir entre esas mismas tarjetas no añadía
> información ni protección, solo pasos. Ahora **se llama desde la propia
> tarjeta**, con un botón que solo se pinta para las sedes llamables.
>
> Se han eliminado, no desactivado: el estado `seleccionando`, los eventos
> `toque-pantalla` y `timeout-seleccion`, el temporizador de 30 s y su pantalla.
>
> **Lo que NO cambió:** elegir a qué sede se llama, y que una sede offline u
> ocupada no sea llamable. Lo retirado es la pantalla intermedia, no la decisión.
>
> **La regla que sí se sustituye:** *"una invitación entrante expulsa al
> selector"* ya no significa nada, porque no hay selector. En su lugar hay una
> carrera más estrecha —llamar y recibir salen ambos de `inactivo`— y la resuelve
> el orden de llegada: quien llega primero gana, y el segundo evento se ignora
> sin efectos.

```
arrancando ─┬─► inactivo ◄───────────────────────┐
            └─► sin-conexión                     │
                                                 │
inactivo ──Llamar en la tarjeta de una sede──► llamando
                                                 │
                                     ┌─el destino acepta─┐
inactivo ─invitación─► recibiendo ───┴───acepta────► en-llamada ──► finalizando ──► inactivo
   ▲                        │
   └── rechaza / timeout ───┘  (queda registrada como perdida)
```

Una llamada tiene **como mucho dos sedes** (revisión del 2026-07-31). El contexto de la máquina no guarda listas: guarda a lo sumo un `origen` (quien nos llama), un `destino` (a quien llamamos) y un `par` (la otra sede ya dentro de la llamada). `destino` y `par` no son lo mismo: durante `llamando` hay destino y todavía no hay par, y es `par` quien decide si un `cuelga` remoto nos deja solos en la sala.

| Estado | Entrada | Salida |
|---|---|---|
| `arrancando` | Carga config y conecta al broker | A `inactivo` o a `sin-conexión` |
| `inactivo` | Modo atractor **y selector**: una tarjeta por sede, con botón Llamar en las llamables | Tocar Llamar, o invitación entrante |
| `llamando` | Publica **la** invitación (una, al único destino). **No crea todavía el iframe** | Que el destino acepte, rechace o no conteste; cancelación; o 45 s |
| `recibiendo` | Timbre y pantalla de llamada entrante | Aceptar, rechazar, o 45 s |
| `en-llamada` | **Crea el iframe de Jitsi** | Colgar, o que cuelgue el par |
| `finalizando` | **Destruye el iframe** y publica `cuelga` | Automática a `inactivo` |
| `sin-conexión` | Transversal | Al reconectar, vuelve **siempre a `inactivo`** |

**El evento `broker-conectado` publica presencia, y publica la verdadera.** Desde `arrancando`, `sin-conexión` e `inactivo` publica `libre`; desde `en-llamada` publica `ocupado` con el `callId` en curso. Es la contrapartida obligatoria de que `en-llamada` sobreviva a la caída del broker (§3.2): quien decide la disponibilidad es esta máquina, nunca la capa de transporte, que no sabe si hay llamada. Desde `finalizando` no publica nada a propósito: ese estado dura milisegundos y la transición a `inactivo` publicará `libre` acto seguido.

Solo el **destino de esta llamada** puede contestarla: una `acepta` de otra sede sobre el mismo `callId` se ignora en vez de meterla en la conversación. El filtro por `callId` del cableado descarta las llamadas ajenas, pero no cubre a una sede que publique sobre el `callId` propio.

### 5.3 Reglas invariantes

1. **Un solo punto crea el iframe de Jitsi y un solo punto lo destruye:** las acciones de entrada y salida de `en-llamada`. En ningún otro lugar del código se toca Jitsi. Si el iframe solo puede nacer y morir en un sitio, no puede quedarse huérfano.

   Esto aplica **también a quien llama**: durante `llamando` no se carga Jitsi. El llamante entra a la sala al mismo tiempo que el primero que acepta, en la transición a `en-llamada`. Además de mantener el invariante, evita levantar una sesión de Jitsi para una llamada que nadie va a contestar.
2. **`sin-conexión` es transversal, con una excepción deliberada.** Se entra desde cualquier estado y se sale **siempre a `inactivo`**. Nunca una pantalla negra sin explicación.

   *Corregido el 2026-07-31.* Este documento decía "se sale al estado seguro", y el contexto llegó a llevar un campo `estadoSeguro` para ello — pero nunca lo leyó nadie: `broker-conectado` siempre ha llamado a `irAInactivo`. El campo se ha eliminado y la regla se redacta como lo que el código hace de verdad. **Volver a `inactivo` es además lo correcto**, no una simplificación: los únicos estados que sobreviven a una caída del broker son `en-llamada` y `finalizando`, así que cuando se pasa por `sin-conexión` el "estado seguro" que se restauraría sería `llamando` o `recibiendo` — un ringback o un timbre de una llamada que el otro lado ya dio por perdida. Reposo es la única salida honesta. *(Antes del 2026-08-10 la lista incluía también `seleccionando`, un selector abierto de hace un minuto.)*

   **La excepción: `en-llamada` y `finalizando` no ceden ante una caída del broker.** Es la consecuencia directa del desacoplamiento de §3.2 — el vídeo viaja por Jitsi, así que una caída de MQTT no tiene por qué cortar la conversación. Si la máquina saliera de `en-llamada`, además de cortar la llamada sin motivo dejaría el iframe huérfano, porque `destruir-jitsi` solo se emite al salir de `en-llamada` por la vía normal. Se pierde la presencia y nada más.
3. **Una invitación durante `en-llamada` no provoca cambio de estado.** Se ignora. Antes del 2026-07-31 era un aviso ("Canarias quiere unirse") porque la tercera sede podía incorporarse; ahora sencillamente no hay a dónde incorporarse. Lo que la regla protege sigue siendo lo mismo y sigue siendo lo importante: **una llamada entrante no puede tumbar una conversación en curso**, que es exactamente lo que hace el sistema antiguo.
4. **Una llamada tiene como mucho dos sedes.** Nadie se incorpora a una llamada en curso, y una sede `ocupado` no es pulsable en el selector. No existe un camino por el que un tercero entre en una conversación.
5. Las transiciones no contempladas no existen. Ese es el objetivo completo.

### 5.4 Temporizadores

| Temporizador | Valor |
|---|---|
| ~~Inactividad en `seleccionando`~~ | *Retirado el 2026-08-10 con la pantalla de selección* |
| Sin respuesta (entrante y saliente) | 45 s |
| Timeout de `videoConferenceJoined` | 15 s |
| Recarga preventiva en reposo | 6 h |
| Backoff de reconexión | 1 s → 30 s máximo |

---

## 6. Interfaz

**Principio rector:** cada pantalla responde a una sola pregunta.

| Pantalla | Contenido |
|---|---|
| **Reposo** | Fondo negro de marca, reloj grande, logotipo discreto, y una tarjeta por sede con estado en vivo: verde libre, ámbar en llamada, gris sin conexión. **Las sedes llamables llevan un botón Llamar**; las offline y las ocupadas no, así que nunca se lanza una llamada al vacío ni a quien ya está hablando |
| ~~**Selección**~~ | *Retirada el 2026-08-10. La de reposo ya era un selector; ver el aviso del §5.2* |
| **Llamando** | La sede a la que se llama, *Sonando…*, ringback audible y cancelar siempre disponible |
| **Recibiendo** | Quién llama, pulso animado, Aceptar en verde grande y Rechazar. Timbre **en bucle con volumen creciente** |
| **En llamada** | Vídeo a pantalla completa, `TOOLBAR_BUTTONS` vacío. Barra propia con micro, cámara y colgar. Se autooculta y reaparece al tocar |
| **Sin conexión** | Mensaje honesto con reintento y contador |

**Por qué la pantalla `llamando` ya no lleva estado por sede.** Hasta el 2026-07-31 mostraba *Sonando… / Aceptó / Rechazó / Sin respuesta* para cada invitada, porque con varias sonando a la vez tenía sentido: una podía haber rechazado mientras otra seguía sonando. Con una sola sede destino, esa pantalla **solo puede mostrar "Sonando…"**: si el destino acepta se pasa a `en-llamada`, y si rechaza o no contesta se vuelve a `inactivo`. Ninguno de los otros tres textos llegaría a pintarse nunca. Mantener el campo habría sido dejar una máquina de estados que sólo puede tomar un valor.

### 6.1 Requisitos técnicos de la interfaz

| Requisito | Motivo |
|---|---|
| Layout en `dvh` y `clamp()` | Se adapta a cualquier resolución y proporción sin media queries manuales |
| Animaciones solo con `transform` y `opacity` | No tocan layout. En un panel modesto es la diferencia entre fluido y a tirones |
| Objetivos táctiles de 120 px o más | Botones de pared a un brazo de distancia, no de móvil a 30 cm |
| Respuesta visual en menos de 100 ms | La sensación de velocidad es percepción, no benchmarks |
| `user-select: none`, `touch-action: manipulation`, sin menú contextual, cursor oculto | Un long-press o un pinch accidental no pueden romper nada |
| Gradiente lento y desplazamiento de píxeles cada minuto en reposo | **Prevención de burn-in** en un panel encendido permanentemente. No es decoración |

### 6.2 Qué desaparece de la interfaz de Jitsi

Se elimina toda la barra nativa. En un panel accesible, los botones de `settings` y `hangup` de Jitsi son un botón de autodestrucción: permiten a cualquiera cambiar el dispositivo de audio o tumbar el sistema sin saber lo que está haciendo.

---

## 7. Manejo de errores

| Fallo | Detección | Respuesta |
|---|---|---|
| Broker inalcanzable al arrancar | El WebSocket no conecta | Pantalla `sin-conexión` + backoff exponencial con tope de 30 s |
| Broker cae en marcha | Cierre o error del WebSocket | Igual, pero **sin cortar la llamada activa** |
| Jitsi no responde | No llega `videoConferenceJoined` en 15 s | Abortar, avisar y volver a reposo |
| Sede no contesta | Temporizador de 45 s | "Sin respuesta" y registro de llamada perdida |
| Cámara o micro ocupados | Error de `getUserMedia` | Mensaje claro y opción de llamada solo audio |
| Pestaña muerta | Watchdog de Windows | Relanza Chrome |
| Fuga de memoria | Recarga programada en reposo | Recarga completa cada 6 h |
| Arranque sin red | Service worker con el shell cacheado | Arranca y explica el problema, en vez de un error del navegador |

**Cambio pequeño con mucho retorno:** autoalojar `external_api.js` en el VPS. Hoy el arranque del tótem depende de que el dominio del tercero responda en ese preciso instante.

---

## 8. Seguridad

Ordenado por urgencia real.

### 8.1 Cerrar las salas — única petición al proveedor de Jitsi

Activar autenticación JWT: el VPS firma un token de vida corta por llamada y Jitsi solo admite la entrada con token válido.

**Mitigación provisional** si el proveedor tarda: nombres de sala con UUID aleatorio de 122 bits. Es aceptable como parche, pero **no es la solución**: no deja de ser seguridad por oscuridad.

Ojo a la diferencia entre los dos sistemas, porque conviven en el repositorio:

- En el **sistema nuevo**, la sala es efímera de verdad: se genera una por llamada y muere al colgar.
- En el **parche de fase 0** (`files/index.html`), la sala es un UUID **permanente y hardcodeado**. No puede ser de otra forma: es una línea abierta 24/7 y todos los tótems tienen que coincidir en el nombre. Quien lea ese fichero no debe suponer que rota.

### 8.2 MQTT

TLS obligatorio, credencial por sede y ACLs según la tabla de §4.6. Nunca una credencial compartida entre sedes.

### 8.3 Credenciales en el repositorio

`info.md` contiene IDs y contraseñas de AnyDesk en texto plano.

Comprobado con `git log --all -- info.md`: **nunca llegó a commitearse**. El árbol base solo contenía `README.md`. Es decir, no hay que reescribir historia ni pasar `git filter-repo` — basta con el `.gitignore`, que ya está.

Aun así conviene **rotar esas contraseñas**: han estado en claro en disco dentro de un directorio de trabajo compartido.

### 8.4 Permisos de cámara y micrófono en el kiosco

Sustituir `--use-fake-ui-for-media-stream` por las políticas de Chrome `AudioCaptureAllowedUrls` y `VideoCaptureAllowedUrls` acotadas al origen propio. Esa bandera concede cámara y micrófono **a cualquier página que se cargue**, no solo a la nuestra.

---

## 9. Despliegue y operación

### 9.1 Estructura del repositorio

```
apps/web/          SPA en Vite + TypeScript
infra/             docker-compose: Mosquitto + Caddy
docs/              este documento y sucesivos
```

### 9.2 Configuración de las sedes

La configuración vive en el broker como mensaje retenido (`config/sedes`), no en cada máquina. Consecuencia directa: **instalar Murcia no requiere tocar Lorca ni Canarias**.

### 9.3 Endurecimiento de Windows

- [ ] Usuario dedicado con inicio de sesión automático
- [ ] Chrome en kiosco lanzado por tarea programada al iniciar sesión
- [ ] Watchdog cada minuto que relance Chrome si el proceso ha muerto
- [ ] Reinicio nocturno programado
- [ ] Suspensión e hibernación desactivadas
- [ ] Actualizaciones de Windows fuera del horario laboral
- [ ] `--disable-session-crashed-bubble` — el globo de "Chrome no se cerró correctamente" es un asesino clásico de kioscos
- [ ] Permisos de media por política de origen en lugar de bandera global

---

## 10. Estrategia de pruebas

| Nivel | Alcance | Herramienta |
|---|---|---|
| Unitario | **La máquina de estados completa** | Vitest |
| Integración | Presencia, LWT y retained reales | Mosquitto en Docker |
| E2E | Llamada completa entre dos sedes | Playwright, dos contextos de navegador |
| Resistencia | **72 h en reposo midiendo memoria** | Manual o automatizado |

Dos notas sobre criterios:

- **La máquina de estados se prueba entera en milisegundos** porque no toca ni DOM ni red. Es la parte más valiosa y la más barata de cubrir. Por eso se diseña separada del resto.
- En E2E, Jitsi se sustituye por un doble. No queremos probar Jitsi; queremos probar nuestra lógica.
- **La prueba de resistencia es la que valida el objetivo del proyecto.** Si el requisito es "que no se cuelgue", tiene que existir una prueba que lo demuestre.

---

## 11. Fases de entrega

| Fase | Contenido | Estado |
|---|---|---|
| **0 — Parche urgente** | Sobre el HTML actual: sala no adivinable, manejo correcto del micro, retirada de `hangup` y `settings` | **Aplicado — pendiente de desplegar** |
| 1 — Infraestructura | Mosquitto + Caddy en el VPS, TLS, credenciales y ACLs | Pendiente |
| 2 — Núcleo | Máquina de estados y cliente MQTT, con sus pruebas | Pendiente |
| 3 — Interfaz | Las seis pantallas | Pendiente |
| 4 — Integración Jitsi | Ciclo de vida del iframe y JWT | Pendiente |
| 5 — Endurecimiento | Windows, watchdog, service worker | Pendiente |
| 6 — Despliegue | Piloto en Lorca ↔ Canarias, después Murcia | Pendiente |

> La fase 0 es independiente del resto. El rediseño lleva semanas; **la sala abierta y el micrófono abierto están expuestos ahora mismo**.

### Detalle de la fase 0 (ya aplicada en `files/index.html`)

| Cambio | Antes | Ahora |
|---|---|---|
| Nombre de sala | `"a"` | `"spm-portal-027240a7-edc8-4270-b991-9f2b442879ec"` |
| Manejo del micro | `toggleAudio` a ciegas + `muteAudio` inexistente | `fijarMicSilenciado(bool)` con estado real sincronizado por `audioMuteStatusChanged` |
| Barra de Jitsi | `microphone, camera, settings, tileview, hangup` | `microphone, camera, tileview` (en `toolbarButtons` y `TOOLBAR_BUTTONS`) |
| Lectura del timbre | Tres rutas, ninguna la documentada | Añadida `event.eventData.text`, la ruta oficial |

**El patrón del micro es el germen del rediseño.** `fijarMicSilenciado(true)` declara el estado destino y solo alterna si hace falta. Es idempotente: llamarlo dos veces no invierte nada. Esa misma idea, aplicada a todo el sistema, es la máquina de estados de §5.

⚠️ **Requisito de despliegue:** el nombre de sala debe ser idéntico en todas las máquinas. Si se actualiza una sede y otra no, quedan en salas distintas y el interfono deja de funcionar. **Hay que copiar el fichero a todos los tótems en la misma intervención.**

---

## 12. Riesgos y cuestiones abiertas

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El proveedor tarda o se niega a activar JWT | Alto | Salas con UUID efímero como parche; escalar la petición desde el principio |
| Los PCs actuales resultan insuficientes | Medio | Medir en la fase 6; Raspberry Pi 5 como plan B por sede |
| Fugas de memoria pese al nuevo ciclo de vida | Medio | La prueba de resistencia de 72 h lo detecta antes de producción |
| Ancho de banda en Canarias | Bajo *(revisado el 2026-07-31)* | Al ser todas las llamadas de dos participantes, `p2p` es aplicable siempre. Queda reactivarlo y medir |

**Cuestiones abiertas:**

1. Stack disponible en el VPS (SO, Docker, puertos libres) — pendiente de confirmar.
2. Funciones adicionales mencionadas por negocio, aún sin detallar. Se analizarán más adelante y pueden requerir revisar este documento.
3. Fecha de la ventana de despliegue de la fase 0 en las dos sedes activas.

---

## Glosario

| Término | Significado |
|---|---|
| **LWT** | *Last Will and Testament*. Mensaje que el broker MQTT publica automáticamente si un cliente se desconecta de forma abrupta |
| **Retained** | Flag de MQTT: el broker guarda el último mensaje de un topic y lo entrega de inmediato a quien se suscriba |
| **JVB** | *Jitsi Videobridge*. El componente que reenvía el media entre participantes |
| **FSM** | Máquina de estados finita |
| **Sede** | Cada oficina con tótem: Canarias, Lorca, Murcia |

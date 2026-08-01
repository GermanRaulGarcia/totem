# Estado del proyecto y siguientes pasos

**Última actualización:** 2026-08-01

Si acabas de coger este proyecto, empieza por aquí. El `README.md` explica *cómo
funciona el sistema*; este documento explica *dónde estamos, qué falta y qué no
hay que volver a discutir*.

---

## Resumen en tres líneas

El rediseño completo (fases 1 a 4) está implementado, probado y en el
[PR #1](https://github.com/GermanRaulGarcia/totem/pull/1), pendiente de revisión
humana. El sistema antiguo sigue en producción en los tres PCs con un parche de
urgencia **ya escrito pero todavía sin desplegar**. Falta la prueba que
demostraría que el problema original está resuelto.

---

## Lo primero que deberías hacer

En este orden:

1. **Desplegar el parche de fase 0.** Es lo único urgente. Está en el primer
   commit de la rama y arregla dos cosas que están vivas ahora mismo en las
   oficinas: una sala de Jitsi pública sin autenticación, y un micrófono que
   lleva meses abierto de forma permanente. Instrucciones abajo.
2. **Leer el diseño** (`docs/superpowers/specs/2026-07-30-totem-redesign-design.md`).
   Es largo, pero es el único sitio donde están las decisiones con su porqué.
3. **Revisar el PR #1.** Su descripción dice por dónde empezar a leer los 32
   commits.

---

## Desplegar el parche de fase 0

Afecta a `files/index.html`, el sistema antiguo. No toca el rediseño.

| Cambio | Antes | Ahora |
|---|---|---|
| Sala de Jitsi | `"a"`, pública y sin autenticación | UUID no adivinable |
| Micrófono | alternaba a ciegas; el cierre automático llamaba a un comando inexistente | estado declarado y reconciliado |
| Barra de Jitsi | incluía `settings` y `hangup` | solo micro, cámara y vista |

**Procedimiento:** copiar `files/index.html` a `C:\Portal\index.html` en cada PC,
por AnyDesk. Las credenciales están en `info.md`, que **no está en el repositorio**
(ver *Lo que no está en el repo*, abajo).

> ⚠️ **Hay que hacerlo en todas las máquinas en la misma intervención.** El nombre
> de sala tiene que coincidir. Si actualizas Lorca y no Canarias, quedan en salas
> distintas y el interfono **deja de funcionar sin dar ningún error**.

**Cómo comprobar que fue bien:** toca la campana dos veces seguidas en un lado.
El micrófono debe seguir abierto. Ese era exactamente el fallo — la segunda
pulsación lo cerraba.

---

## Qué está hecho y qué no

| | Estado |
|---|---|
| Fase 0 — parche urgente | Escrito. **Sin desplegar** |
| Fases 1-4 — el rediseño | Completo. 146 tests + 1 E2E. En el PR #1 |
| Fase 5 — endurecer Windows | **No empezada.** Usuario kiosco, autologin, watchdog, reinicio nocturno, sin suspensión ni updates en horario |
| Fase 5 — service worker | **No empezada.** Aplazada a propósito hasta tener despliegue estable |
| Fase 6 — despliegue por sedes | **No empezada.** Piloto Lorca ↔ Canarias, después Murcia |
| Prueba de resistencia 72 h | **No existe.** Ver abajo |

### La prueba que falta, y por qué importa

El objetivo del proyecto es "que no se cuelgue". Hay un diseño que debería
conseguirlo —en reposo el tótem no ejecuta prácticamente nada— y **ninguna
evidencia empírica de que lo haga**.

La prueba: dejar un tótem 72 horas en reposo midiendo la memoria del proceso de
Chrome. Hasta que eso pase, el objetivo del proyecto es una hipótesis razonada,
no un hecho. No la des por buena porque los 146 tests estén en verde: prueban que
la lógica es correcta, no que el navegador aguante tres días.

---

## Bloqueado por terceros

**Autenticación JWT en Jitsi.** `meet.sunube.net` es de SPM pero lo administra un
proveedor externo. Hay que pedirle que active JWT en las salas.

Es **la única petición que este proyecto le hace a ese tercero en toda su vida** —
el diseño se hizo así a propósito, para minimizar la fricción. Mientras no esté,
el nombre de sala es un UUID aleatorio: eso es oscuridad, no seguridad.

---

## Fallos conocidos

Ninguno impide desplegar, pero están identificados y no deben redescubrirse.

| Fallo | Dónde | Detalle |
|---|---|---|
| El timbre suena en bucle indefinido | `apps/web/src/core/maquina-estados.ts:89-96` | Si el broker cae mientras suena una llamada, se pasa a `sin-conexion` con `efectos: []` — no se emite `parar-timbre` ni `parar-ringback` ni `cancelar-timer`. El `setInterval` del sonido no se detiene nunca y el temporizador de 45 s queda armado, disparando luego contra `inactivo`, que lo ignora. Kiosco pitando cada 1,5-2,5 s hasta recargar. **Es el candidato número uno para la próxima ronda** |
| Quien llama no distingue rechazo de no-respuesta | `apps/web/src/core/maquina-estados.ts` | Rechazado, sin contestar y cancelado acaban los tres en `irAInactivo` con los mismos efectos y la misma pantalla. Solo el que recibe registra la llamada perdida |
| Deuda de flakiness en los tests MQTT | `apps/web/src/mqtt/cliente-mqtt.test.ts` | Esperan con `setTimeout` fijos en vez de esperar el evento concreto. Estables en local, pero fallarán antes o después en una máquina cargada |
| `finalizando` no republica presencia | — | Dura milisegundos y falla del lado seguro. Documentado por si alguien lo ve y lo toma por olvido |

---

## Decisiones ya tomadas — no las reabras sin motivo nuevo

Cada una costó una discusión. El porqué está en el diseño.

| Decisión | Razón corta |
|---|---|
| **Se mantienen los PCs con Windows** | El fallo era de software. Raspberry Pi o app Android nativa solo trasladan el cuelgue a otra máquina |
| **Mosquitto en VPS propio**, no Cloudflare ni la máquina de Jitsi | El VPS es nuestro y con root propio: coste marginal cero e independencia del proveedor externo |
| **Llamadas 1 a 1** | Negocio retiró el multi-sede el 2026-07-31. Si ves `destinos: string[]` o `publicar-invitaciones` en el historial, **no es funcionalidad perdida** |
| **La credencial MQTT viaja en la URL del kiosco** | Quien pueda leerla ya tiene acceso físico a ese tótem. Lo que protegen las ACLs —que una sede no falsifique la presencia de otra— se mantiene intacto. Caddy no puede inyectarla: la autenticación MQTT va en el paquete CONNECT, dentro del WebSocket |
| **Nada de CDN en tiempo de ejecución** | `external_api.js` se autoaloja. El arranque del tótem no puede depender de que responda el dominio del tercero |

---

## Cosas que parecen bugs y no lo son

Si vas a "arreglar" alguna de estas, lee antes el comentario que hay junto al
código. Todas están así a propósito.

- **`sinCambios()` devuelve la MISMA referencia de contexto.** No es un descuido:
  `Totem.emitir` detecta si hubo cambio de estado con `resultado.contexto !== contexto`.
- **El guard de `broker-desconectado` excluye `en-llamada` y `finalizando`.** Una
  caída del broker **no debe** cortar una llamada: el vídeo va por Jitsi, no por
  MQTT. Es el desacoplamiento del §3.2 del diseño.
- **El mensaje de LWT se publica con `retained: true`, y el cierre ordenado
  publica `online:false` por su cuenta.** Lo segundo hace falta porque un
  `DISCONNECT` limpio hace que el broker **descarte** el Will.
- **El listener de Jitsi comprueba la identidad de la api.** Sin eso, un evento
  tardío de una sesión ya destruida señalaría un fallo sobre la llamada actual,
  que está sana.
- **El E2E usa `dispatchEvent('click')` y no `click()`** sobre la tarjeta en
  reposo. `click()` exige actionability y la tarjeta tiene `pointer-events: none`
  más la animación anti burn-in, así que Playwright la rechazaría. `dispatchEvent`
  prueba justo lo que importa: que el enrutado va por estructura del DOM.
- **La sala del sistema antiguo (`files/index.html`) es un UUID permanente**, no
  efímero. Es una línea abierta 24/7 y todos los tótems tienen que coincidir.
- **La animación lenta de la pantalla en reposo no es decoración.** Es prevención
  de burn-in en un panel encendido de forma permanente.

---

## Lo que no está en el repo

| Qué | Dónde está | Para qué lo necesitas |
|---|---|---|
| `info.md` | Fuera del repo, gitignorado | IDs y contraseñas de AnyDesk para entrar en los PCs de las sedes |
| Credenciales del VPS | Fuera del repo | Desplegar Mosquitto y Caddy |
| `infra/mosquitto/passwd` | Se genera en el VPS, nunca se versiona | Autenticación MQTT por sede |
| `external_api.js` | Se descarga en el despliegue | Ver `infra/README.md` |

Las contraseñas de AnyDesk de `info.md` **estuvieron en claro en un directorio de
trabajo compartido**. Nunca llegaron a commitearse —verificado con
`git log --all -- info.md`, así que no hay que reescribir historia— pero lo
prudente es rotarlas.

---

## Antes de desplegar el rediseño

- [ ] Desplegar primero el parche de fase 0 en las tres máquinas
- [ ] Rotar las contraseñas de AnyDesk
- [ ] Generar una credencial MQTT **por sede** en el VPS, nunca compartida
- [ ] Sustituir el dominio de ejemplo en `infra/Caddyfile`
- [ ] Aprovisionar `external_api.js` autoalojado
- [ ] Publicar el directorio de sedes con `-r` (retenido) — sin ese flag, un tótem
      que arranque después no se entera de qué sedes existen
- [ ] Pedir al proveedor la autenticación JWT
- [ ] Ejecutar la prueba de resistencia de 72 h

---

## Una nota sobre cómo se construyó esto

Durante la ejecución se encontraron y corrigieron 14 defectos importantes. **Doce
estaban en el documento de diseño o en el plan, no en el código escrito a partir
de ellos.** El patrón se repitió siempre: se escribía una regla en el documento y
luego el código no la cumplía en todos los sitios donde importaba.

Hubo un momento con 71 pruebas en verde conviviendo con seis defectos que
impedían desplegar: la aplicación no podía autenticarse contra el broker, no se
recuperaba de un corte de red, y el vídeo se pintaba fuera de la pantalla. Los
seis vivían **entre módulos**, y cada módulo había pasado su propia revisión.

Si vas a revisar cambios en este repo, la lección práctica es: contrasta el código
contra *la intención del diseño* —enumera las vías de entrada y salida de un
estado, pregúntate de dónde sale cada dependencia— y no contra el diff ni contra
si la suite pasa. Una suite verde, por sí sola, no es evidencia de nada.

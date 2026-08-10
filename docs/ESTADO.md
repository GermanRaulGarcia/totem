# Estado del proyecto y siguientes pasos

**Última actualización:** 2026-08-03

Si acabas de coger este proyecto, empieza por aquí. El `README.md` explica *cómo
funciona el sistema*; este documento explica *dónde estamos, qué falta y qué no
hay que volver a discutir*.

---

## Resumen en tres líneas

El rediseño completo (fases 1 a 4) está implementado, probado y **mergeado en
`main`** por el [PR #1](https://github.com/GermanRaulGarcia/totem/pull/1). El
sistema antiguo sigue en producción en los tres PCs con un parche de urgencia
**ya escrito pero todavía sin desplegar**. Falta la prueba que demostraría que el
problema original está resuelto.

---

## Lo primero que deberías hacer

En este orden:

1. **Desplegar el parche de fase 0.** Es lo único urgente. Está en el primer
   commit de la rama y arregla dos cosas que están vivas ahora mismo en las
   oficinas: una sala de Jitsi pública sin autenticación, y un micrófono que
   lleva meses abierto de forma permanente. Instrucciones abajo.
2. **Leer el diseño** (`docs/superpowers/specs/2026-07-30-totem-redesign-design.md`).
   Es largo, pero es el único sitio donde están las decisiones con su porqué.
3. **Leer el [PR #1](https://github.com/GermanRaulGarcia/totem/pull/1).** Ya está
   mergeado, pero su descripción sigue siendo el mejor índice por donde empezar a
   leer los 32 commits.

---

## Desplegar el parche de fase 0

Afecta a `files/index.html`, el sistema antiguo. No toca el rediseño.

| Cambio | Antes | Ahora |
|---|---|---|
| Sala de Jitsi | `"a"`, pública y sin autenticación | UUID no adivinable |
| Micrófono | alternaba a ciegas; el cierre automático llamaba a un comando inexistente | estado declarado y reconciliado |
| Barra de Jitsi | incluía `settings` y `hangup` | solo micro, cámara y vista |
| Disposición del vídeo | mosaico: todos del mismo tamaño | vista de orador: el otro grande, uno mismo en miniatura *(añadido el 2026-08-04)* |

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
| Fases 1-4 — el rediseño | Completo. 159 tests + 1 E2E. Mergeado en `main` |
| Fase 1 — infra en el VPS | Ficheros listos en `infra/`. **Nada levantado todavía** |
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
no un hecho. No la des por buena porque los tests estén en verde: prueban que la
lógica es correcta, no que el navegador aguante tres días.

Ojo al montarla: desde el 2026-08-03 el tótem **se recarga solo cada 6 h** en
reposo (`src/runtime/recarga-preventiva.ts`). Es lo que pide el diseño §3.3, pero
falsea la medición si no lo tienes en cuenta: la memoria bajará cada 6 horas
porque la pestaña es nueva, no porque no haya fuga. Para medir la fuga de verdad,
sube `ms` o desactívala durante la prueba.

---

## Autenticación JWT en Jitsi

> **Corregido el 2026-08-04.** El diseño y las versiones anteriores de este
> documento decían que `meet.sunube.net` lo administraba un *proveedor externo*
> con plazos y fricción. **No es así:** lo administra el programador anterior,
> sobre Docker, en un servidor suyo. La petición del JWT va a él. La fricción
> prevista era mucho mayor que la real.

Mientras no esté, el nombre de sala es un UUID aleatorio: eso es oscuridad, no
seguridad.

### ⚠️ El JWT no está implementado por nuestro lado

La fase 4 figura como completa y el diseño §8.1 habla de que «el VPS firma un
token de vida corta por llamada». **Ese código no existe.** Verificado con un
grep de `jwt`/`token` sobre `apps/web/src` e `infra`: no hay nada. `main.ts` no
pasa `jwt` al construir `JitsiMeetExternalAPI`, y no hay ningún emisor de tokens
en el VPS.

Es otro caso del patrón que describe la última sección de este documento: la
regla está escrita en el diseño y el código no la cumple.

**Consecuencia práctica: activar JWT no es un solo paso, son tres, y el orden
importa.**

1. El administrador de Jitsi activa la autenticación y nos da `JWT_APP_ID` y
   `JWT_APP_SECRET`
2. Nosotros construimos el emisor de tokens en el VPS
3. `main.ts` pasa el token al iframe

> 🚨 **Que NO se active en producción antes del paso 3.** Con `ENABLE_AUTH=1`,
> cualquier cliente que no presente un token válido deja de poder entrar en la
> sala — y el sistema antiguo (`files/index.html`), que es el que está en
> producción, no envía ninguno. Activarlo hoy deja los tres tótems fuera y el
> interfono muerto, sin previo aviso.

Lo ideal es pedir un dominio o instancia **de pruebas** con JWT activo, para
desarrollar el paso 2 sin tocar la que da servicio.

---

## Fallos conocidos

Ninguno impide desplegar, pero están identificados y no deben redescubrirse.

| Fallo | Dónde | Detalle |
|---|---|---|
| Quien llama no distingue rechazo de no-respuesta | `apps/web/src/core/maquina-estados.ts` | Rechazado, sin contestar y cancelado acaban los tres en `irAInactivo` con los mismos efectos y la misma pantalla. Solo el que recibe registra la llamada perdida |
| Las llamadas perdidas no se guardan ni se ven | `apps/web/src/main.ts` | El efecto `registrar-perdida` acaba en un `console.warn`. Nada se persiste y nada se pinta: en la práctica la llamada perdida no existe para el usuario |
| Deuda de flakiness en los tests MQTT | `apps/web/src/mqtt/cliente-mqtt.test.ts` | Esperan con `setTimeout` fijos en vez de esperar el evento concreto. Estables en local, pero fallarán antes o después en una máquina cargada |
| `finalizando` no republica presencia | — | Dura milisegundos y falla del lado seguro. Documentado por si alguien lo ve y lo toma por olvido |

---

## El panel de las sedes (hardware)

Nada de esto está en el diseño, que solo habla de endurecer Windows. Se descubrió
en campo el 2026-08-04 y costó una mañana entera. **Léelo antes de tocar un
tótem**, porque los síntomas se confunden con fallos de software.

**Modelo:** Philips **BDL4152E**, E-Line Collaboration Display, con **Android 14**
casi de serie. Es un panel táctil con su propio sistema operativo dentro; el PC
con Windows va aparte y entra por **HDMI 1**. El panel actúa solo de monitor.

### La configuración vive en DOS sitios distintos

| Dónde | Qué hay | Cómo se llega |
|---|---|---|
| Ajustes de Android | Sistema del panel: red, apps, tiempo de espera de pantalla | Interfaz Android del panel |
| **OSD del panel** | **Imagen, Audio, Configuración, Opción avanzada** — fuente de entrada, ahorro de energía, temporizadores | Botón **MENU** del **mando a distancia** |

El OSD **no** está dentro de los Ajustes de Android. Si buscas ahí la fuente de
entrada o el ahorro de energía, no los vas a encontrar. Hace falta el mando.

> ⚠️ La documentación de señalización de Philips que se encuentra por internet
> (rutas tipo *Signage Display → Boot on Source*) es de otra gama, la D-Line/B-Line.
> **En este modelo esos menús no existen.** No pierdas el tiempo buscándolos.

### Pantalla llena de "gris" o nieve: es el HDMI, no el software

Síntoma: pasados unos minutos el panel se llena de ruido de vídeo. Por AnyDesk el
escritorio se ve perfecto, lo que despista mucho — AnyDesk lee el framebuffer de
Windows y no dice nada sobre el estado del cable.

**Causa:** el enlace HDMI no aguanta 3840x2160 **@ 60 Hz** (unos 18 Gbps, el tope
de HDMI 2.0). Reiniciar lo arreglaba un rato porque renegociaba el enlace, y eso
mandaba la investigación por caminos falsos.

**Solución aplicada:** forzar **30 Hz** en Windows. Baja a ~9 Gbps y es estable,
verificado tras reinicio. No se pierde nada: el vídeo de Jitsi va a 30 fps o
menos, así que a 60 Hz se pintaban los mismos fotogramas exigiéndole al cable el
doble.

```
Configuración → Sistema → Pantalla → Configuración avanzada de pantalla
    → Frecuencia de actualización → 30 Hz
```

Cómo comprobarlo sin entrar en Windows: pulsa **SOURCE** en el mando y el panel
muestra un banner con el modo que está recibiendo de verdad. Debe decir
`3840x2160 @ 30 Hz`. **Ese banner es la fuente de verdad**, no lo que diga Windows.

Detalles que ahorran tiempo:

- La lista de resoluciones de Windows aparece **girada** (`2160x3840`) porque el
  panel está en vertical. El equivalente a 1080p se llama ahí `1080 x 1920`.
- **Verifica siempre el modo tras un reinicio.** Windows revuelve la frecuencia al
  redetectar la pantalla, y en un kiosco desatendido nadie vería la regresión.
- Si algún día se quieren recuperar los 60 Hz: cable certificado *Premium High
  Speed* (18 Gbps) y corto; activo o de fibra si el tendido pasa de 5 m.

### Otros sustos del panel, ya descartados como causa

- **Se va a Android él solo.** Cualquiera puede mandarlo ahí desde el botón
  flotante de la esquina o desde los botones del lateral derecho. Se vuelve con
  **SOURCE → HDMI 1**.
- **Se pone en blanco al cerrar Chrome.** Al cortarse la señal, el panel salta a su
  fuente interna. No es que el parche haya salido mal. Reiniciar el PC lo devuelve.
- **Ahorro de energía de Windows.** Ya desactivado (`powercfg /change
  monitor-timeout-ac 0` y equivalentes). No era la causa de la nieve, pero tenía
  que estarlo igualmente: es un punto de la fase 5.

### Pendiente en este apartado

- [ ] Aplicar la misma revisión al panel de la otra sede
- [ ] Cambiar el cable HDMI cuando se pueda pasar sin prisa: uno que ya va justo
      empeora con el calor y el tiempo, y el síntoma será otra vez la nieve
- [ ] Bloquear el Android del panel (menú flotante y botones del lateral) para que
      nadie lo tape por accidente. El rediseño **no** resuelve esto: si el panel se
      pone delante, da igual lo bueno que sea el software del PC

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

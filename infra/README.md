# Infraestructura del tótem

> ### Cambio del 2026-08-11: Caddy fuera, Apache de puerta
>
> El diseño original levantaba **Caddy** en el 80 y el 443. En el VPS real esos
> puertos los tiene **Apache 2.4.58 con varias webs en producción**, así que
> disputárselos era tumbar el servicio. Se intentó y falló con
> `address already in use` — Apache ni se inmutó, pero el contenedor no arrancaba.
>
> El `Caddyfile` se ha **borrado**, no desactivado: describía un despliegue
> imposible en la única máquina donde esto va a correr, y una receta que no
> funciona cuesta más que ninguna.
>
> **Ahora Apache sirve la SPA y traduce el WebSocket, y Mosquitto escucha solo en
> `127.0.0.1`.** Efecto secundario bueno: el broker no está expuesto a internet;
> solo se llega a él atravesando Apache por TLS.
>
> El `VirtualHost` está en [`apache/app-interfono.conf`](apache/app-interfono.conf),
> comentado a fondo. Léelo antes de tocarlo: los dos `VirtualHost` tienen
> `DocumentRoot` **distinto** a propósito, y hay al menos tres decisiones ahí que
> parecen arbitrarias y no lo son.

## Despliegue en producción

**Dominio:** `interfono.kordino.com` · **Registro A** en Dinahosting apuntando a
la IP del VPS. Sin `AAAA`: si existe un IPv6 que no responde, Let's Encrypt lo
intenta **primero** y la emisión falla con un error que no apunta a la causa.

**Estructura en el VPS**, siguiendo la nomenclatura existente (`app_<nombre>`):

| Ruta | Qué es |
|---|---|
| `/var/www/app_interfono/` | El repositorio. **No servido** |
| `/var/www/app_interfono/apps/web/dist/` | El `DocumentRoot` del :443. Solo lo compilado |

Que el `DocumentRoot` sea el `dist` y no la raíz **no es estética**: Apache sirve
los ficheros que existen, y `FallbackResource` solo actúa sobre los que no. Con la
raíz servida, `infra/mosquitto/passwd` y `.git/` quedarían descargables.

### Reglas para tocar Apache en esa máquina

Hay webs en producción detrás. No son sugerencias:

- **Fichero propio, jamás editar los `VirtualHost` existentes.** La vuelta atrás
  es `a2dissite app-interfono` y recargar.
- **`apache2ctl configtest` antes de cada recarga.**
- **`systemctl reload`, nunca `restart`.** El *reload* mantiene la configuración
  anterior si la nueva falla; un *restart* con un error tumba todos los sitios.

### Pasos

1. Generar las contraseñas de cada sede.

   **Una credencial por sede, nunca compartida.** Es lo que hace que las ACLs
   sirvan de algo: cada usuario solo puede publicar su propio estado, así que
   una sede comprometida no puede falsificar la presencia de otra. Con una
   credencial común esa garantía desaparece entera.

   Sin `-b`: ese flag deja la contraseña en el historial del shell y visible en
   `ps aux` para cualquier usuario de la máquina mientras dura el comando. La
   forma interactiva la pide por consola y no la escribe en ninguna parte:

```bash
cd infra
touch mosquitto/passwd
for USUARIO in totem-lorca totem-canarias totem-murcia operaciones; do
    docker run --rm -it -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
        mosquitto_passwd /m/passwd "$USUARIO"
done
```

Si necesitas hacerlo sin terminal interactiva (por ejemplo desde un script de
aprovisionamiento), usa un heredoc con `-c` sobre un fichero temporal en vez de
pasar la contraseña como argumento:

```bash
docker run --rm -i -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    sh -s <<'EOF'
read -r CLAVE          # llega por stdin, no aparece en la lista de procesos
mosquitto_passwd -b /m/passwd totem-lorca "$CLAVE"
EOF
```

`mosquitto/passwd` NO se versiona; ya está en `.gitignore`.

⚠️ **Comprueba después de CADA usuario que ha entrado de verdad:**

```bash
cut -d: -f1 mosquitto/passwd
```

Si las dos confirmaciones de la contraseña no coinciden, `mosquitto_passwd`
**aborta en silencio** y no escribe nada. Pasó en el primer despliegue: de cuatro
usuarios solo se guardaron dos, y el síntoma fue `not authorised` en un tótem cuyo
usuario sencillamente no existía.

Y **`mosquitto_passwd` reescribe el fichero**, así que vuelve a ser de root y
pierde los permisos. Hay que rehacerlos **cada vez** que se toca una credencial, o
Mosquitto no arranca:

```bash
chown 1883:1883 mosquitto/passwd mosquitto/acl
chmod 600 mosquitto/passwd
chmod 0700 mosquitto/acl
```

💡 **Que las contraseñas lleven solo letras y números.** Viajan en la URL del
kiosco, y ahí `&` corta el parámetro, `#` manda el resto a un fragmento que no se
envía, `+` se decodifica como espacio y `%` se interpreta como escape.
`openssl rand -hex 24` da algo imposible de romper en una URL.

2. Descargar `external_api.js` para autoalojarlo, **dentro de la web**:

```bash
mkdir -p apps/web/public/vendor
curl -fSL -o apps/web/public/vendor/external_api.js https://meet.sunube.net/external_api.js
```

⚠️ **El `-f` no es opcional.** Sin él, `curl` guarda el cuerpo de un error HTTP
como si fuera el fichero: un `external_api.js` de 19 bytes con el texto
`404 page not found` dentro. El navegador lo carga, revienta al interpretarlo, y
el tótem arranca con la interfaz perfecta pero vuelve a reposo nada más aceptar
una llamada, emitiendo `jitsi-fallo`. Un fallo caro de diagnosticar por lo poco
que se parece a su causa. Comprueba siempre el tamaño: debe rondar los 100 KB.

Comprobado el 2026-08-04: **`https://meet.sunube.net/external_api.js` responde 404
desde fuera de las oficinas** (la raíz del dominio también). Si te pasa al
aprovisionar el VPS, pregunta al administrador de Jitsi antes de dar el paso por
bueno.

3. Construir la web y levantar el broker:

```bash
cd apps/web && npm ci && npm run build
cd ../../infra && docker compose up -d
```

Comprueba que el broker **no está expuesto**. Debe decir `127.0.0.1:9001`; si
dice `0.0.0.0:9001`, está abierto a internet:

```bash
ss -ltnp | grep 9001
```

4. Colocar `apache/app-interfono.conf` en `/etc/apache2/sites-available/`,
   `a2ensite app-interfono`, `apache2ctl configtest` y `systemctl reload apache2`.

   El certificado se emite **antes** de activar el bloque `:443`, y con
   `certonly --webroot`, no con `--apache`: en una máquina con webs en producción
   no interesa que certbot edite configuración que no hemos escrito nosotros.

```bash
certbot certonly --webroot -w /var/www/app_interfono -d interfono.kordino.com
```

⚠️ Ese `-w` queda grabado en `/etc/letsencrypt/renewal/`. **Si luego se mueve o
renombra esa carpeta, la renovación falla** — dentro de 60 días, de madrugada y
sin avisar, hasta que los tótems dejen de conectar por certificado caducado.

5. Publicar el directorio de sedes (ver más abajo) y lanzar cada tótem con **su
   propia** credencial. El usuario y la contraseña viajan como parámetros de la URL
   de arranque, junto a `?sede=`; sin ellos Mosquitto responde CONNACK 5
   (`allow_anonymous false`) y el tótem no conecta.

```
chrome.exe --kiosk ^
  "https://interfono.kordino.com/?sede=lorca&nombre=Lorca&usuario=totem-lorca&contrasena=CONTRASENA_LORCA" ^
  --autoplay-policy=no-user-gesture-required ^
  --no-first-run ^
  --disable-session-crashed-bubble
```

| Sede | `sede` | `usuario` |
|---|---|---|
| Lorca | `lorca` | `totem-lorca` |
| Gran Canaria | `canarias` | `totem-canarias` |
| Murcia | `murcia` | `totem-murcia` |

Parámetros opcionales: `broker` (por defecto `wss://{host}/mqtt`) y `jitsi` (por
defecto `meet.sunube.net`).

Que la contraseña esté a la vista en la URL del kiosco es una decisión tomada,
no un descuido: quien pueda leerla ya tiene acceso físico a ese tótem. Lo que
protegen las ACLs —que una sede comprometida no falsifique la presencia de
**otra**— no depende de dónde viva la credencial de esta. El razonamiento
completo está en `apps/web/src/main.ts`.

## Desarrollo local (sin Docker)

Vite sirve los estáticos de `apps/web/public/` directamente, así que
`external_api.js` no llega ahí solo. Sin este paso, `npm run dev` responde
404 para `/vendor/external_api.js` y Jitsi no arranca:

```bash
mkdir -p apps/web/public/vendor
curl -fSL -o apps/web/public/vendor/external_api.js https://meet.sunube.net/external_api.js
```

Mismo aviso que arriba con el `-f`, y misma comprobación de tamaño. Para una
prueba en local vale también la copia pública:

```bash
curl -fSL -o apps/web/public/vendor/external_api.js https://meet.jit.si/external_api.js
```

El script es un cargador genérico: monta el iframe contra el dominio que se le
pase en `new JitsiMeetExternalAPI(...)`, así que sirve para probar contra
`meet.sunube.net`. Para producción, usa la copia del propio servidor: si las
versiones se separan mucho, alguna función puede no responder.

`apps/web/public/vendor/` no se versiona (ver `.gitignore`), igual que
`infra/vendor/` en producción: cada entorno descarga su propia copia.

## Publicar el directorio de sedes

Se hace una vez, y otra vez cada vez que se añade una sede.
El flag `-r` es obligatorio: sin retención, un tótem que arranque no lo recibirá.
Todo payload MQTT lleva `ts` en ISO 8601; se genera con `date` en el momento
de publicar, no se escribe a mano, para que nadie publique una marca de
tiempo obsoleta.

```bash
docker compose exec mosquitto mosquitto_pub -h localhost \
    -u operaciones -P CONTRASENA_OPERACIONES \
    -t config/sedes -r -q 1 -m "{
      \"ts\": \"$(date -u +%FT%TZ)\",
      \"sedes\": [
        {\"id\":\"lorca\",\"nombre\":\"Lorca\",\"orden\":1,\"zona\":\"Europe/Madrid\"},
        {\"id\":\"canarias\",\"nombre\":\"Gran Canaria\",\"orden\":2,\"zona\":\"Atlantic/Canary\"},
        {\"id\":\"murcia\",\"nombre\":\"Murcia\",\"orden\":3,\"zona\":\"Europe/Madrid\"}
      ]
    }"
```

**`zona` es la zona horaria IANA de la sede.** Con ella, la tarjeta de una sede
que va en otra hora la muestra en pantalla — Canarias va una hora por detrás de
la península, y llamar a las 9:00 desde Lorca es llamar a las 8:00 allí. Solo se
pinta cuando difiere de la hora del propio tótem; si coincide, no aparece.

Va en IANA (`Atlantic/Canary`) y no como un desfase en horas para que el cambio
de hora lo resuelva el navegador: con un `-1` escrito a mano habría que revisarlo
dos veces al año en un kiosco que nadie mira.

Es **opcional**: una sede sin `zona` simplemente no muestra hora. Y una `zona` mal
escrita tampoco rompe nada —se ignora—, pero repásala: `config/sedes` es un
mensaje retenido, así que una errata llega a los tres tótems y se queda.

## Comprobar la presencia en vivo

```bash
docker compose exec mosquitto mosquitto_sub -h localhost \
    -u operaciones -P CONTRASENA_OPERACIONES -t 'totem/+/estado' -v
```

## Verificar que el LWT funciona

Con el comando anterior corriendo, desenchufa la red de un tótem.
En menos de un minuto debe aparecer su mensaje con `"online": false`.
Si no aparece, revisa que el LWT se publique con `retain: true`.

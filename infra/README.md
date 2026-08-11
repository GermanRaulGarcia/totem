# Infraestructura del tótem

## Primer despliegue

1. Sustituir el dominio de ejemplo en `infra/Caddyfile`
   (`totem.sunube.net`) por el dominio real del VPS. Si se deja el
   placeholder, el HTTPS automático de Caddy falla al pedir el
   certificado: el proveedor de ACME rechaza un dominio que no controlas.

2. Generar las contraseñas de cada sede.

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

3. Descargar `external_api.js` para autoalojarlo:

```bash
mkdir -p vendor
curl -fSL -o vendor/external_api.js https://meet.sunube.net/external_api.js
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

4. Construir la web y levantar:

```bash
cd ../apps/web && npm ci && npm run build
cd ../../infra && docker compose up -d
```

5. Lanzar cada tótem con **su propia** credencial. El usuario y la contraseña
   viajan como parámetros de la URL de arranque, junto a `?sede=`; sin ellos
   Mosquitto responde CONNACK 5 (`allow_anonymous false`) y el tótem no conecta.

```
chrome.exe --kiosk ^
  "https://totem.sunube.net/?sede=lorca&nombre=Lorca&usuario=totem-lorca&contrasena=CONTRASENA_LORCA" ^
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

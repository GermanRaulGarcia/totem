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
curl -o vendor/external_api.js https://meet.sunube.net/external_api.js
```

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
curl -o apps/web/public/vendor/external_api.js https://meet.sunube.net/external_api.js
```

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
        {\"id\":\"lorca\",\"nombre\":\"Lorca\",\"orden\":1},
        {\"id\":\"canarias\",\"nombre\":\"Gran Canaria\",\"orden\":2},
        {\"id\":\"murcia\",\"nombre\":\"Murcia\",\"orden\":3}
      ]
    }"
```

## Comprobar la presencia en vivo

```bash
docker compose exec mosquitto mosquitto_sub -h localhost \
    -u operaciones -P CONTRASENA_OPERACIONES -t 'totem/+/estado' -v
```

## Verificar que el LWT funciona

Con el comando anterior corriendo, desenchufa la red de un tótem.
En menos de un minuto debe aparecer su mensaje con `"online": false`.
Si no aparece, revisa que el LWT se publique con `retain: true`.

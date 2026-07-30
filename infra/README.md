# Infraestructura del tótem

## Primer despliegue

1. Generar las contraseñas de cada sede:

```bash
cd infra
touch mosquitto/passwd
docker run --rm -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    mosquitto_passwd -b /m/passwd totem-lorca CONTRASENA_LORCA
docker run --rm -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    mosquitto_passwd -b /m/passwd totem-canarias CONTRASENA_CANARIAS
docker run --rm -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    mosquitto_passwd -b /m/passwd totem-murcia CONTRASENA_MURCIA
docker run --rm -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    mosquitto_passwd -b /m/passwd operaciones CONTRASENA_OPERACIONES
```

`mosquitto/passwd` NO se versiona. Añádelo a `.gitignore`.

2. Descargar `external_api.js` para autoalojarlo:

```bash
mkdir -p vendor
curl -o vendor/external_api.js https://meet.sunube.net/external_api.js
```

3. Construir la web y levantar:

```bash
cd ../apps/web && npm ci && npm run build
cd ../../infra && docker compose up -d
```

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

```bash
docker compose exec mosquitto mosquitto_pub -h localhost \
    -u operaciones -P CONTRASENA_OPERACIONES \
    -t config/sedes -r -q 1 -m '{
      "sedes": [
        {"id":"lorca","nombre":"Lorca","orden":1},
        {"id":"canarias","nombre":"Gran Canaria","orden":2},
        {"id":"murcia","nombre":"Murcia","orden":3}
      ]
    }'
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

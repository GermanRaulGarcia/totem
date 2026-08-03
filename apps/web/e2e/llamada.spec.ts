import { test, expect, type Page } from '@playwright/test';
import { arrancarBroker, type BrokerDePrueba } from '../src/mqtt/broker-de-prueba';

let broker: BrokerDePrueba;

test.beforeAll(async () => { broker = await arrancarBroker(); });
test.afterAll(async () => { await broker.parar(); });

/** El broker de prueba habla TCP; el navegador necesita ws. Se usa el puerto ws de aedes. */
const urlPara = (sede: string) =>
    `/?sede=${sede}&nombre=${sede}&broker=${encodeURIComponent(broker.urlWs)}`;

async function abrirTotem(page: Page, sede: string): Promise<void> {
    // Se sustituye Jitsi por un doble: aqui probamos NUESTRA logica, no la de Jitsi.
    await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).JitsiMeetExternalAPI = class {
            constructor(_host: string, opciones: { parentNode: HTMLElement }) {
                const padre = opciones.parentNode;
                // Se anota EN QUE nodo se ha pedido montar el iframe. Comprobar que
                // `#jitsi` es visible no vale de nada: es un div `position: fixed`
                // vacio, siempre visible aunque el iframe cuelgue de otro sitio y
                // acabe fuera de la pantalla del kiosco.
                document.body.setAttribute('data-jitsi-padre', padre?.id ?? '(ninguno)');
                padre.appendChild(document.createElement('iframe'));
                document.body.setAttribute('data-jitsi', 'activo');
            }
            executeCommand() {}
            addEventListener() {}
            async isAudioMuted() { return false; }
            dispose() { document.body.setAttribute('data-jitsi', 'destruido'); }
        };
    });
    await page.goto(urlPara(sede));
    await expect(page.locator('.pantalla--reposo')).toBeVisible({ timeout: 10_000 });
}

test('una llamada de Lorca a Murcia se establece y se cuelga', async ({ browser }) => {
    const ctxLorca = await browser.newContext();
    const ctxMurcia = await browser.newContext();
    const lorca = await ctxLorca.newPage();
    const murcia = await ctxMurcia.newPage();

    await abrirTotem(lorca, 'lorca');
    await abrirTotem(murcia, 'murcia');

    // Lorca ve a Murcia disponible.
    await expect(lorca.locator('[data-sede="murcia"]')).toContainText('Disponible');

    // Lorca llama a Murcia. El primer toque va sobre la TARJETA de sede, el
    // objetivo mas grande de la pantalla de reposo, que antes se tragaba el toque.
    // Se usa `dispatchEvent` y no `click()` a proposito: `click()` exige que el
    // elemento sea "actionable" y la tarjeta inerte tiene `pointer-events: none` y
    // hereda la animacion anti burn-in, asi que Playwright la rechazaria. Lo que
    // aqui se prueba es justo lo contrario: que el enrutado del click delegado
    // funcione por ESTRUCTURA del DOM, sin depender de la hoja de estilos.
    await lorca.locator('[data-sede="murcia"]').dispatchEvent('click');
    await expect(lorca.locator('.pantalla--seleccion')).toBeVisible();
    await lorca.locator('[data-sede="murcia"]').click();
    await lorca.locator('[data-accion="llamar"]').click();
    await expect(lorca.locator('.pantalla--llamando')).toBeVisible();

    // Mientras suena, Lorca NO ha creado el iframe, y ve a Murcia sonando.
    await expect(lorca.locator('body')).not.toHaveAttribute('data-jitsi', 'activo');
    await expect(lorca.locator('[data-destino="murcia"]')).toContainText('Sonando');

    // Murcia recibe y acepta.
    await expect(murcia.locator('.pantalla--entrante')).toBeVisible();
    await murcia.locator('[data-accion="aceptar"]').click();

    // Ambos entran en llamada y el iframe cuelga DEL contenedor de video, no de
    // `<main>`: montarlo en main lo dejaria a y = 100dvh, fuera de una pantalla
    // que no puede hacer scroll. Habria audio y no habria imagen.
    await expect(murcia.locator('body')).toHaveAttribute('data-jitsi-padre', 'jitsi');
    await expect(lorca.locator('body')).toHaveAttribute('data-jitsi-padre', 'jitsi');
    await expect(murcia.locator('#jitsi iframe')).toHaveCount(1);
    await expect(lorca.locator('#jitsi iframe')).toHaveCount(1);

    // Murcia cuelga: se destruye su iframe...
    await murcia.locator('[data-accion="colgar"]').click();
    await expect(murcia.locator('body')).toHaveAttribute('data-jitsi', 'destruido');
    await expect(murcia.locator('.pantalla--reposo')).toBeVisible();

    // ...y Lorca, que se queda sola en la sala, suelta la suya tambien. Sin esto,
    // Lorca se quedaria en `en-llamada` con un iframe vivo en una sala vacia:
    // exactamente el fallo del sistema antiguo que este proyecto elimina.
    await expect(lorca.locator('body')).toHaveAttribute('data-jitsi', 'destruido');
    await expect(lorca.locator('.pantalla--reposo')).toBeVisible();

    // Sin cerrar los contextos, sus conexiones MQTT por WebSocket quedan abiertas
    // y wss.close() (en broker.parar(), afterAll) espera indefinidamente a que
    // se cierren: el proceso quedaria colgado con handles vivos.
    await ctxLorca.close();
    await ctxMurcia.close();
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, type Vista } from './pantallas';
import { contextoEn } from '../core/maquina-estados';
import type { EstadoSede } from '../core/tipos';

const sede = (id: string, online: boolean, disp: 'libre' | 'ocupado' = 'libre'): EstadoSede => ({
    sede: id, nombre: id.toUpperCase(), online, disponibilidad: disp,
    callId: null, ts: '2026-07-30T10:00:00Z'
});

describe('pantallas', () => {
    let raiz: HTMLElement;
    beforeEach(() => { raiz = document.createElement('div'); });

    const vista = (parcial: Partial<Vista>): Vista => ({
        contexto: contextoEn('inactivo'),
        sedes: [sede('murcia', true)],
        seleccion: [],
        reloj: '10:00',
        ...parcial
    });

    it('en reposo muestra el reloj y la invitacion a tocar', () => {
        render(raiz, vista({}));
        expect(raiz.textContent).toContain('10:00');
        expect(raiz.textContent).toContain('Toca para llamar');
    });

    it('en reposo pinta una tarjeta por sede', () => {
        render(raiz, vista({ sedes: [sede('murcia', true), sede('canarias', false)] }));
        expect(raiz.querySelectorAll('[data-sede]')).toHaveLength(2);
    });

    it('marca las sedes offline como no seleccionables', () => {
        render(raiz, vista({
            contexto: contextoEn('seleccionando'),
            sedes: [sede('canarias', false)]
        }));
        const tarjeta = raiz.querySelector<HTMLButtonElement>('[data-sede="canarias"]');
        expect(tarjeta!.disabled).toBe(true);
    });

    it('el boton de llamar esta deshabilitado sin seleccion', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando') }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(true);
    });

    it('el boton de llamar se habilita con al menos una sede', () => {
        render(raiz, vista({ contexto: contextoEn('seleccionando'), seleccion: ['murcia'] }));
        const boton = raiz.querySelector<HTMLButtonElement>('[data-accion="llamar"]');
        expect(boton!.disabled).toBe(false);
    });

    it('en recibiendo muestra quien llama y los dos botones', () => {
        const ctx = { ...contextoEn('recibiendo'), origen: 'murcia' };
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.textContent).toContain('murcia');
        expect(raiz.querySelector('[data-accion="aceptar"]')).not.toBeNull();
        expect(raiz.querySelector('[data-accion="rechazar"]')).not.toBeNull();
    });

    it('en sin-conexion explica el problema en vez de quedarse en negro', () => {
        render(raiz, vista({ contexto: contextoEn('sin-conexion') }));
        expect(raiz.textContent).toContain('Sin conexion');
    });

    it('en en-llamada no pinta el contenedor de video dos veces', () => {
        const ctx = contextoEn('en-llamada');
        render(raiz, vista({ contexto: ctx }));
        render(raiz, vista({ contexto: ctx }));
        expect(raiz.querySelectorAll('#jitsi')).toHaveLength(1);
    });
});

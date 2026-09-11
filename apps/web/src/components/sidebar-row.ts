/**
 * La fila de la barra lateral, compartida por las modalidades y las clases.
 *
 * Vive en su propio módulo y no en `site-chrome.tsx` ni en `class-nav.tsx`
 * porque lo usan un componente de servidor y uno de cliente: una constante
 * exportada desde un módulo `"use client"` le llega al servidor como referencia
 * de cliente y no como el texto, y la fila se pintaría sin estilo.
 */
export const SIDEBAR_ROW = "flex items-center gap-2.5 rounded px-3 py-1.5 text-sm";

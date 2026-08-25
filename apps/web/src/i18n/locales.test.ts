import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { localeFromPathname, localizedPathname, negotiateLocale } from "./locales";

describe("negotiateLocale", () => {
  it("elige el idioma fuente cuando el navegador no dice nada", () => {
    assert.equal(negotiateLocale(null), "en");
    assert.equal(negotiateLocale(""), "en");
  });

  it("reconoce la subetiqueta primaria por encima de la región", () => {
    assert.equal(negotiateLocale("es-ES"), "es");
    assert.equal(negotiateLocale("es-419"), "es");
    assert.equal(negotiateLocale("en-US"), "en");
  });

  it("respeta el factor de calidad, no el orden de aparición", () => {
    assert.equal(negotiateLocale("en;q=0.5,es;q=0.9"), "es");
    assert.equal(negotiateLocale("es;q=0.2,en;q=0.8"), "en");
  });

  it("a igual calidad gana el que aparece antes", () => {
    assert.equal(negotiateLocale("es,en"), "es");
    assert.equal(negotiateLocale("en,es"), "en");
  });

  it("salta los idiomas que no servimos", () => {
    assert.equal(negotiateLocale("fr-FR,de;q=0.9,es;q=0.1"), "es");
  });

  it("cae al idioma fuente cuando no servimos ninguno de los pedidos", () => {
    assert.equal(negotiateLocale("fr-FR,de;q=0.9"), "en");
  });

  it("descarta lo marcado como no aceptable", () => {
    // q=0 en RFC 9110 es "esto no lo quiero", no "esto me da igual".
    assert.equal(negotiateLocale("es;q=0,fr"), "en");
  });

  it("ignora un factor de calidad ilegible en vez de tomarlo por 1", () => {
    assert.equal(negotiateLocale("es;q=alto,en"), "en");
  });

  it("sirve el idioma fuente ante un comodín", () => {
    assert.equal(negotiateLocale("*"), "en");
    assert.equal(negotiateLocale("fr;q=0.9,*;q=0.1"), "en");
  });
});

describe("localeFromPathname", () => {
  it("lee el prefijo cuando existe", () => {
    assert.equal(localeFromPathname("/es"), "es");
    assert.equal(localeFromPathname("/es/spec/frost-mage"), "es");
  });

  it("no confunde una ruta sin prefijo con una prefijada", () => {
    assert.equal(localeFromPathname("/"), undefined);
    assert.equal(localeFromPathname("/spec/frost-mage"), undefined);
    // "esp" empieza por "es" y no es un locale: comparar por prefijo de texto
    // en vez de por segmento serviría español a una ruta que no lo pide.
    assert.equal(localeFromPathname("/esp/spec"), undefined);
  });
});

describe("localizedPathname", () => {
  it("prefija la raíz sin dejar barra colgando", () => {
    assert.equal(localizedPathname("/", "en"), "/en");
  });

  it("prefija una ruta cualquiera", () => {
    assert.equal(localizedPathname("/spec/frost-mage", "es"), "/es/spec/frost-mage");
  });

  it("cambia el prefijo sin duplicarlo, que es lo que hace el conmutador", () => {
    assert.equal(localizedPathname("/en/spec/frost-mage", "es"), "/es/spec/frost-mage");
    assert.equal(localizedPathname("/en", "es"), "/es");
  });
});

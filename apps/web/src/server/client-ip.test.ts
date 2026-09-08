import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketKey, clientIp } from "./client-ip";

const headers = (entries: Record<string, string>): Headers => new Headers(entries);

describe("de quién viene la petición", () => {
  it("prefiere la cabecera del hosting a la reenviada", () => {
    // Es la única que no puede falsificar quien llama: la pone el edge con la
    // dirección que abrió la conexión, pise lo que pise.
    const found = clientIp(
      headers({ "x-nf-client-connection-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }),
    );

    assert.equal(found, "9.9.9.9");
  });

  it("de la cabecera reenviada se queda con el último salto, no con el primero", () => {
    // Este es el fallo que convertiría el límite en decoración: el cliente puede
    // mandar su propia cabecera y el proxy añade la real detrás, así que
    // quedarse con la primera deja elegir la clave a quien la envía — y con ella
    // vaciarle el cubo a otra persona.
    assert.equal(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" })), "9.9.9.9");
  });

  it("no inventa una dirección cuando no llega ninguna", () => {
    assert.equal(clientIp(headers({})), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": "  " })), null);
  });

  it("quita el puerto de una IPv4 que lo traiga", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "1.2.3.4:51234" })), "1.2.3.4");
  });

  it("recorta una IPv6 a su prefijo /64", () => {
    // Un cliente doméstico recibe el /64 entero: hashear los 128 bits dejaría
    // rotar por miles de millones de direcciones sin coste.
    assert.equal(
      clientIp(headers({ "x-forwarded-for": "2001:0db8:85a3:0000:1111:2222:3333:4444" })),
      "2001:db8:85a3:0",
    );
  });

  it("da el mismo prefijo escriba la dirección como la escriba", () => {
    // La forma comprimida puede estar en cualquier posición, así que quedarse
    // con los cuatro primeros grupos del texto tal cual daría redes distintas
    // para la misma dirección.
    const expanded = clientIp(headers({ "x-forwarded-for": "2001:db8:0:0:0:0:0:1" }));
    const compressed = clientIp(headers({ "x-forwarded-for": "2001:db8::1" }));
    const bracketed = clientIp(headers({ "x-forwarded-for": "[2001:db8::1]" }));

    assert.equal(expanded, "2001:db8:0:0");
    assert.equal(compressed, expanded);
    assert.equal(bracketed, expanded);
  });
});

describe("la clave del cubo", () => {
  it("es estable para la misma dirección y el mismo ámbito", () => {
    assert.equal(bucketKey("submit", "1.2.3.4", "sal"), bucketKey("submit", "1.2.3.4", "sal"));
  });

  it("separa los ámbitos, así que dos cubos de la misma persona no se enlazan", () => {
    assert.notEqual(bucketKey("submit", "1.2.3.4", "sal"), bucketKey("suggest", "1.2.3.4", "sal"));
  });

  it("cambia entera al cambiar la sal", () => {
    // Es lo que hace que rotar la sal vacíe todos los cubos, y lo que impide
    // recorrer las 2^32 direcciones de IPv4 para invertir el hash.
    assert.notEqual(bucketKey("submit", "1.2.3.4", "sal"), bucketKey("submit", "1.2.3.4", "otra"));
  });

  it("no deja ver la dirección", () => {
    assert.doesNotMatch(bucketKey("submit", "1.2.3.4", "sal"), /1\.2\.3\.4/);
  });
});

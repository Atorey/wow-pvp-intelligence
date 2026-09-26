import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMb, parseOptions, quotaStatus } from "./db-size";

const MB = 1024 * 1024;

test("sin argumentos es la medición barata, con el aviso en 400 MB", () => {
  assert.deepEqual(parseOptions([]), { detail: false, alertMb: 400 });
});

test("--alert-mb acepta un entero positivo y rechaza el resto", () => {
  assert.equal(parseOptions(["--alert-mb", "450"]).alertMb, 450);
  assert.throws(() => parseOptions(["--alert-mb", "0"]), /entero mayor que cero/);
  assert.throws(() => parseOptions(["--alert-mb", "4.5"]), /entero mayor que cero/);
  assert.throws(() => parseOptions(["--alert-mb"]), /entero mayor que cero/);
});

test("una opción desconocida no se ignora en silencio", () => {
  assert.throws(() => parseOptions(["--table", "x"]), /Opción desconocida/);
});

test("por encima de la cuota es un estado distinto de por encima del aviso", () => {
  assert.equal(quotaStatus(399 * MB, 400), "ok");
  assert.equal(quotaStatus(401 * MB, 400), "alert");
  // 665 MB fue la medición del 26 de septiembre de 2026.
  assert.equal(quotaStatus(665 * MB, 400), "over-quota");
  // Un aviso mal configurado por encima de la cuota no la esconde.
  assert.equal(quotaStatus(510 * MB, 600), "over-quota");
});

test("los MB son los de pg_size_pretty, para que la serie de mediciones siga comparable", () => {
  assert.equal(formatMb(665 * MB), "665.0 MB");
  assert.equal(formatMb(String(1.5 * MB)), "1.5 MB");
});

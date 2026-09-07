import { createHmac } from "node:crypto";

/**
 * De quién viene la petición, para el límite por IP (ADR 0030).
 *
 * Es un módulo puro —recibe unas cabeceras y devuelve texto— porque aquí es
 * donde se esconde el fallo que anularía el límite entero, y eso se prueba sin
 * red delante ni base de datos.
 */

/**
 * La que pone Netlify con la IP que abrió la conexión contra su edge,
 * sobrescribiendo lo que traiga el cliente. Es la única de confianza.
 */
const NETLIFY_HEADER = "x-nf-client-connection-ip";

/** Cuántos hextetos de una IPv6 se conservan: los cuatro primeros son el /64. */
const IPV6_PREFIX_HEXTETS = 4;

/** Longitud de la clave en base64url. 22 caracteres son 132 bits: de sobra. */
const KEY_LENGTH = 22;

/**
 * La dirección de quien pide, o `null` si no hay forma de saberlo.
 *
 * `x-forwarded-for` se lee por su **último** segmento y no por el primero, que
 * es el error que convierte un límite por IP en decoración: el cliente puede
 * enviar su propia cabecera y el proxy añade la dirección real al final, así que
 * quedarse con el primero deja elegir la clave a quien la manda — y con ella,
 * vaciarle el cubo a otra persona.
 */
export function clientIp(headers: Headers): string | null {
  const netlify = headers.get(NETLIFY_HEADER);
  if (netlify?.trim()) return normalize(netlify.trim());

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  const last = hops[hops.length - 1];
  return last ? normalize(last) : null;
}

/**
 * La clave del cubo: un HMAC truncado de la dirección.
 *
 * HMAC y no un hash pelado porque IPv4 son 2^32 direcciones, que se recorren
 * enteras por fuerza bruta en segundos: la sal secreta es lo único que hace
 * irreversible el resultado, y es lo que permite escribir en la política de
 * privacidad que la dirección no se puede recuperar.
 *
 * El ámbito entra en el mensaje además de ser columna, así los cubos de dos
 * endpoints de la misma persona no son enlazables ni por quien mire la tabla.
 */
export function bucketKey(scope: string, ip: string, salt: string): string {
  return createHmac("sha256", salt)
    .update(`${scope}:${ip}`)
    .digest("base64url")
    .slice(0, KEY_LENGTH);
}

/**
 * Deja la dirección en la forma que se hashea.
 *
 * Lo que importa aquí es el truncado de IPv6 a su prefijo /64: un cliente
 * doméstico recibe un /64 entero, así que hashear los 128 bits deja rotar por
 * miles de millones de direcciones sin coste y el límite no limita nada. Falla
 * en silencio, y no se ve en desarrollo local, donde todo es IPv4.
 *
 * IPv4 se conserva entera. El precio es que un CGNAT o el NAT de una empresa
 * comparten cubo, y por eso las capacidades son generosas y configurables.
 */
function normalize(raw: string): string | null {
  const value = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw;
  if (!value) return null;

  if (value.includes(":")) {
    // Dos puntos y ningún hexteto de más: es IPv4 con puerto, no IPv6.
    if (value.split(":").length === 2) return value.split(":")[0] ?? null;
    return prefix64(value);
  }

  return value;
}

/**
 * Los cuatro primeros hextetos de una IPv6, con el `::` expandido.
 *
 * Se expande a mano en vez de con una librería porque la forma comprimida puede
 * estar en cualquier posición, y quedarse con los cuatro primeros grupos del
 * texto tal cual daría prefijos distintos para la misma red según cómo se
 * escriba la dirección.
 */
function prefix64(value: string): string | null {
  const zone = value.indexOf("%");
  const address = zone === -1 ? value : value.slice(0, zone);
  const compressed = address.includes("::");

  const [head = "", tail = ""] = address.split("::", 2);
  const left = head.split(":").filter((part) => part.length > 0);
  const right = compressed ? tail.split(":").filter((part) => part.length > 0) : [];

  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  const filler = compressed ? Array<string>(missing).fill("0") : [];
  const hextets = [...left, ...filler, ...right];
  if (hextets.length < IPV6_PREFIX_HEXTETS) return null;

  return hextets
    .slice(0, IPV6_PREFIX_HEXTETS)
    .map((hextet) => hextet.toLowerCase().replace(/^0+(?=.)/u, ""))
    .join(":");
}

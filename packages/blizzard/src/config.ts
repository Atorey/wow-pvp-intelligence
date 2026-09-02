/**
 * Lo que hace falta configurar para hablar con Blizzard, leído del entorno.
 *
 * Está aquí y no en `apps/pipeline` porque desde el ADR 0013 hay **dos** procesos
 * que llaman a Blizzard —el pipeline y cada invocación de la web— y los dos
 * tienen que leer los mismos números. `BLIZZARD_REQUESTS_PER_HOUR` es el caso
 * claro: el techo no vive en la tabla de cuota, viaja como parámetro desde aquí,
 * así que un proceso con otro valor rellenaría el bucket compartido más rápido
 * de lo que debe y el margen del otro dejaría de existir.
 *
 * Lo que **no** está aquí es de dónde salen las variables. El pipeline las carga
 * de un `.env` en la raíz del repo; en Netlify las pone el sitio y no hay
 * fichero que leer. Cargarlas desde este módulo obligaría a inventar una raíz
 * de repo que en serverless no existe.
 */
import { REGIONS, isRegion, type Region } from "@wowpvp/core";

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en el entorno. ${hint}`);
  }
  return value;
}

export function getRegion(): Region {
  const raw = (process.env["BLIZZARD_REGION"] ?? "eu").toLowerCase();
  // La lista es la de `packages/core` porque la región también es un tramo de
  // ruta pública: ingerir una que el sitio no sabe publicar deja datos sin
  // página a la que colgarlos.
  if (!isRegion(raw)) {
    throw new Error(`BLIZZARD_REGION="${raw}" no es válida. Opciones: ${REGIONS.join(", ")}.`);
  }
  return raw;
}

/**
 * Ritmo al que **este** proceso se espacia a sí mismo. No es el techo de nadie
 * más: el techo compartido por segundo es `BLIZZARD_GLOBAL_PER_SECOND`.
 *
 * Son dos números distintos a propósito. Si el bucket compartido se configurase
 * con este valor, el pipeline corriendo a su ritmo normal dejaría a la web sin
 * margen instantáneo ninguno.
 */
export function getRequestsPerSecond(): number {
  const raw = process.env["BLIZZARD_REQUESTS_PER_SECOND"];
  const parsed = raw ? Number(raw) : 8;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_REQUESTS_PER_SECOND="${raw}" no es un número válido.`);
  }
  return parsed;
}

/**
 * Capacidad del bucket **compartido** por segundo (ADR 0013, decisión 3). El
 * límite real de Blizzard es 100/s por client ID; el default va por debajo
 * porque N invocaciones serverless concurrentes pueden coincidir en el mismo
 * segundo sin que ninguna lo sepa.
 */
export function getGlobalPerSecond(): number {
  const raw = process.env["BLIZZARD_GLOBAL_PER_SECOND"];
  const parsed = raw ? Number(raw) : 80;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_GLOBAL_PER_SECOND="${raw}" no es un número válido.`);
  }
  return parsed;
}

/**
 * Techo horario **global** de peticiones a Blizzard (ADR 0013, decisión 3).
 *
 * Cambió de significado: era un margen por proceso —dos jobs solapados no se
 * veían entre ellos y de ahí el 24.000 sobre 36.000— y ahora es el techo real y
 * compartido, porque el presupuesto vive en Postgres y todos miran la misma
 * cuenta. El margen que queda cubre los desfases de reloj entre procesos y
 * cualquier `fetch` que se escape del cliente; estrecharlo del todo no, porque
 * lo que no pasa por el bucket no lo cuenta nadie.
 *
 * Tiene que valer lo mismo en todos los procesos que compartan client ID: el
 * valor no vive en la tabla, viaja como parámetro desde aquí, así que uno mal
 * configurado rellenaría el bucket más rápido de lo que debe.
 */
export function getRequestsPerHour(): number {
  const raw = process.env["BLIZZARD_REQUESTS_PER_HOUR"];
  const parsed = raw ? Number(raw) : 32_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_REQUESTS_PER_HOUR="${raw}" no es un número válido.`);
  }
  return parsed;
}

/**
 * Fichas del bucket horario que solo `on-demand` puede gastar (ADR 0013,
 * decisión 5).
 *
 * La prioridad deja de ser un orden y pasa a ser una reserva. Un proceso
 * efímero no puede esperar su turno en una cola que no ve, así que ceder el
 * paso ya no se puede implementar ordenando: se implementa con un colchón que
 * el trabajo de fondo no toca. 2.000 son ~330 búsquedas de usuario.
 */
export function getOnDemandReserve(): number {
  const raw = process.env["BLIZZARD_ON_DEMAND_RESERVE"];
  const parsed = raw ? Number(raw) : 2_000;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`BLIZZARD_ON_DEMAND_RESERVE="${raw}" no es un número de peticiones válido.`);
  }
  return parsed;
}

/**
 * Presupuesto de tiempo total de una búsqueda con un humano esperando delante
 * (ADR 0013, decisión 7).
 *
 * Existe porque Netlify corta la función a los 10 segundos: agotarlo respondiendo
 * "ahora mismo no puedo mirarlo" es mejor que agotarlo con un timeout, que desde
 * fuera se ve igual que un error. Un lookup son 4 peticiones más una por bracket
 * —3-4 s para un jugador de dos specs— y un solo 429 con `Retry-After` de 5 s se
 * lleva el resto, así que el margen es real y no holgura.
 */
export function getLookupTimeBudgetMs(): number {
  const raw = process.env["BLIZZARD_LOOKUP_TIME_BUDGET_MS"];
  const parsed = raw ? Number(raw) : 8_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_LOOKUP_TIME_BUDGET_MS="${raw}" no es un número de ms válido.`);
  }
  return parsed;
}

/**
 * Minutos que se considera fresco el perfil de un personaje ya consultado.
 *
 * §28 pide caché corta (15-30 min) en el refresco bajo demanda: sin ella,
 * cinco búsquedas seguidas del mismo personaje cuestan cinco veces la cuota y
 * meten cinco snapshots casi idénticos en un histórico append-only, que es la
 * forma más rápida de convertir el moat en ruido. 30 es el extremo alto del
 * rango del plan: el rating de un jugador no cambia entre dos partidas.
 */
export function getCharacterLookupTtlMinutes(): number {
  const raw = process.env["CHARACTER_LOOKUP_TTL_MINUTES"];
  const parsed = raw ? Number(raw) : 30;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`CHARACTER_LOOKUP_TTL_MINUTES="${raw}" no es un número de minutos válido.`);
  }
  return parsed;
}

export function getBlizzardCredentials(): { clientId: string; clientSecret: string } {
  const hint = "Crea un client en https://develop.battle.net/access (ver apps/pipeline/README.md).";
  return {
    clientId: required("BLIZZARD_CLIENT_ID", hint),
    clientSecret: required("BLIZZARD_CLIENT_SECRET", hint),
  };
}

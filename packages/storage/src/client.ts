/**
 * Supabase Storage, lo justo para el archivo y su índice (ADR 0034, ADR 0039).
 *
 * El plan gratuito da 1 GB de Storage como cuota **aparte** de los 500 MB de la
 * base: no es otro proveedor ni una migración, es el mismo proyecto. Por eso el
 * histórico frío va ahí y no a disco, a un bucket de terceros o a Git.
 *
 * Vive en un paquete y no en el pipeline porque desde el ADR 0039 también lee la
 * web, y una app no importa de otra.
 *
 * Se habla con la API REST a pelo y no con `@supabase/supabase-js`: son cuatro
 * llamadas, y el SDK entero para ellas sería la única dependencia de runtime que
 * no es Postgres. El `fetch` se inyecta para poder probarlo sin red.
 */

export interface StorageConfig {
  /** `https://<ref>.supabase.co`, sin barra final. */
  url: string;
  /** Clave con permisos de servicio: el bucket es privado y nadie más escribe en él. */
  serviceKey: string;
  bucket: string;
}

export type Fetch = typeof fetch;

/** El bucket del archivo si nadie dice otro. Lo comparten quien escribe y quien lee. */
export const DEFAULT_ARCHIVE_BUCKET = "snapshot-archive";

/**
 * La URL del proyecto a partir de la cadena de Postgres, para no pedir en el
 * `.env` un dato que ya está en otro.
 *
 * Supabase la codifica de dos formas según por dónde se conecte: en el pooler,
 * el usuario es `postgres.<ref>`; en la conexión directa, el host es
 * `db.<ref>.supabase.co`. Fuera de esas dos devuelve null y quien llama pide
 * `SUPABASE_URL` explícita: adivinar el proyecto al que se sube el histórico no
 * es algo que convenga hacer por aproximación.
 */
export function supabaseUrlFrom(databaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }

  const pooler = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(parsed.username));
  if (pooler && parsed.hostname.endsWith(".pooler.supabase.com")) {
    return `https://${pooler[1]}.supabase.co`;
  }

  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(parsed.hostname);
  if (direct) return `https://${direct[1]}.supabase.co`;

  return null;
}

function headers(config: StorageConfig): Record<string, string> {
  // Las dos cabeceras: las claves JWT de siempre se aceptan en `authorization`,
  // y las `sb_secret_` nuevas, que no son un JWT, solo en `apikey`.
  return { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey };
}

function objectUrl(config: StorageConfig, objectPath: string): string {
  return `${config.url}/storage/v1/object/${config.bucket}/${objectPath}`;
}

/**
 * Crea el bucket si no existe, siempre privado.
 *
 * Privado porque son observaciones de personajes con nombre: publicarlas en un
 * bucket abierto sería sacar de la web una copia entera de la población que la
 * web solo enseña de una en una.
 */
export async function ensureBucket(config: StorageConfig, fetchFn: Fetch = fetch): Promise<void> {
  const existing = await fetchFn(`${config.url}/storage/v1/bucket/${config.bucket}`, {
    headers: headers(config),
  });
  if (existing.ok) {
    const bucket = (await existing.json()) as { public?: boolean };
    if (bucket.public) {
      throw new Error(
        `El bucket "${config.bucket}" es público. El archivo guarda la población entera ` +
          `con nombre y reino; ponlo privado en Supabase antes de archivar nada en él.`,
      );
    }
    return;
  }

  const created = await fetchFn(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers(config), "content-type": "application/json" },
    body: JSON.stringify({ id: config.bucket, name: config.bucket, public: false }),
  });
  if (!created.ok) {
    throw new Error(
      `No se pudo crear el bucket "${config.bucket}": ${created.status} ${await created.text()}`,
    );
  }
}

/**
 * Sube un objeto. Por defecto **falla si ya existe**.
 *
 * `x-upsert: false` es la garantía de que el archivo nunca se sobrescribe: si
 * una ruta se repitiera, sobrescribir perdería el lote anterior sin que nada
 * avisara, y ese lote ya no está en Postgres. `upsert` es para el índice, que sí
 * se reescribe entero cada vez que crece y se puede reconstruir desde el archivo.
 */
export async function uploadObject(
  config: StorageConfig,
  objectPath: string,
  body: Buffer,
  options: { upsert?: boolean } = {},
  fetchFn: Fetch = fetch,
): Promise<void> {
  const response = await fetchFn(objectUrl(config, objectPath), {
    method: "POST",
    headers: {
      ...headers(config),
      "content-type": "application/gzip",
      "x-upsert": options.upsert ? "true" : "false",
    },
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(
      `Storage rechazó ${config.bucket}/${objectPath}: ${response.status} ${await response.text()}`,
    );
  }
}

/**
 * Baja un objeto, o `null` si no existe.
 *
 * "No existe" llega de dos formas: un 404, o —según la versión de Storage— un
 * 400 que dice 404 en el cuerpo. Cualquier otro fallo es un error y no un
 * `null`: tratar una caída como "no hay nada" haría que quien lee pintara una
 * serie vacía, y quien escribe, que reescribiera el objeto desde cero.
 */
export async function downloadObject(
  config: StorageConfig,
  objectPath: string,
  fetchFn: Fetch = fetch,
): Promise<Buffer | null> {
  const response = await fetchFn(objectUrl(config, objectPath), { headers: headers(config) });
  if (response.ok) return Buffer.from(await response.arrayBuffer());

  const text = await response.text();
  if (response.status === 404 || (response.status === 400 && isNotFound(text))) return null;
  throw new Error(`Storage no devolvió ${config.bucket}/${objectPath}: ${response.status} ${text}`);
}

function isNotFound(body: string): boolean {
  try {
    const json = JSON.parse(body) as { statusCode?: unknown; error?: unknown };
    return String(json.statusCode) === "404" || json.error === "not_found";
  } catch {
    return false;
  }
}

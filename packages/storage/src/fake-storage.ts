import type { Fetch, StorageConfig } from "./client";

/**
 * Un Storage en memoria para los tests: guarda lo que se sube y devuelve lo que
 * se pide, con los mismos códigos que el de verdad.
 *
 * Existe para poder probar la fusión del índice de punta a punta —bajar, fundir,
 * volver a subir— sin red, y para que un test pueda comprobar lo que quedó
 * escrito mirando los objetos y no las llamadas.
 */
export const FAKE_STORAGE: StorageConfig = {
  url: "https://ref.supabase.co",
  serviceKey: "secreta",
  bucket: "archivo",
};

export function fakeStorage(): { fetchFn: Fetch; objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  const prefix = `${FAKE_STORAGE.url}/storage/v1/object/${FAKE_STORAGE.bucket}/`;

  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    // El bucket existe y es privado: lo que se prueba aquí son los objetos.
    if (href === `${FAKE_STORAGE.url}/storage/v1/bucket/${FAKE_STORAGE.bucket}`) {
      return new Response(JSON.stringify({ public: false }), { status: 200 });
    }
    if (!href.startsWith(prefix)) return new Response("fuera del fake", { status: 500 });
    const path = href.slice(prefix.length);

    if ((init?.method ?? "GET") === "GET") {
      const body = objects.get(path);
      return body
        ? new Response(new Uint8Array(body), { status: 200 })
        : new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 });
    }

    const upsert = (init?.headers as Record<string, string> | undefined)?.["x-upsert"] === "true";
    if (objects.has(path) && !upsert) return new Response("Duplicate", { status: 409 });
    objects.set(path, Buffer.from(init?.body as Uint8Array));
    return new Response("{}", { status: 200 });
  }) as Fetch;

  return { fetchFn, objects };
}

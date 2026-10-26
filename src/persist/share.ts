// Share links: the whole .hbs, deflated and base64url-encoded in the URL
// hash (#map=...), so nothing goes through a server.
const PREFIX = "#map=";

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const toBase64Url = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

export async function encodeMap(text: string): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));
}

export async function decodeMap(code: string): Promise<string> {
  return new TextDecoder().decode(await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw")));
}

export async function shareUrl(text: string, base = location.href): Promise<string> {
  return base.split("#")[0] + PREFIX + (await encodeMap(text));
}

// The map in the current URL, if any.
export function sharedCode(hash = location.hash): string | null {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null;
}

// SPDX-License-Identifier: AGPL-3.0-only
// Multi-material fork: minimal ZIP reader (stored + deflate) for Fusion .sdz files.
// Uses the platform's DecompressionStream; no dependencies.

export interface ZipEntry {
  name: string;
  size: number;
  /** Decompressed content. */
  read(): Promise<Uint8Array>;
}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** List the entries of a ZIP archive. Throws on anything that is not a
 *  readable ZIP (no ZIP64, no encryption — Fusion exports use neither). */
export function readZip(bytes: ArrayBuffer | Uint8Array): ZipEntry[] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // End-of-central-directory record: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (u32(dv, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end-of-central-directory record)");
  const count = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16);
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (u32(dv, p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const flags = u16(dv, p + 8);
    const method = u16(dv, p + 10);
    const csize = u32(dv, p + 20);
    const usize = u32(dv, p + 24);
    const nlen = u16(dv, p + 28);
    const elen = u16(dv, p + 30);
    const clen = u16(dv, p + 32);
    const lho = u32(dv, p + 42);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    if (flags & 1) throw new Error(`ZIP entry "${name}" is encrypted`);
    out.push({
      name,
      size: usize,
      async read() {
        if (u32(dv, lho) !== 0x04034b50) throw new Error(`corrupt ZIP local header for "${name}"`);
        const start = lho + 30 + u16(dv, lho + 26) + u16(dv, lho + 28);
        const raw = u8.subarray(start, start + csize);
        if (method === 0) return raw.slice();
        if (method === 8) return inflateRaw(raw);
        throw new Error(`ZIP entry "${name}" uses unsupported compression method ${method}`);
      },
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

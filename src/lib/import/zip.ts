import { inflateSync } from "fflate";

// Reads only the entries we want out of a zip, straight from the File.
// A full Instagram export with photos and videos can run to several GB, and
// this way only the zip's index and the few small JSON/HTML files are loaded.

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX = 0xffffffff;

async function read(blob: Blob, start: number, end: number): Promise<DataView> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function bytes(view: DataView, start: number, length: number): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset + start, length);
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

async function listEntries(blob: Blob): Promise<Entry[]> {
  // End-of-central-directory record: 22 bytes plus up to 64 KB of comment,
  // with a 20-byte zip64 locator in front of it on big archives.
  const tailStart = Math.max(0, blob.size - (22 + 0xffff + 20));
  const tail = await read(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file isn't a zip archive.");

  let count = tail.getUint16(eocd + 10, true);
  let dirSize = tail.getUint32(eocd + 12, true);
  let dirOffset = tail.getUint32(eocd + 16, true);
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === EOCD64_LOCATOR) {
    const at = Number(tail.getBigUint64(eocd - 20 + 8, true));
    const rec = await read(blob, at, at + 56);
    if (rec.getUint32(0, true) === EOCD64) {
      count = Number(rec.getBigUint64(32, true));
      dirSize = Number(rec.getBigUint64(40, true));
      dirOffset = Number(rec.getBigUint64(48, true));
    }
  }

  const dir = await read(blob, dirOffset, dirOffset + dirSize);
  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= dir.byteLength; i++) {
    if (dir.getUint32(p, true) !== CENTRAL_ENTRY) throw new Error("This zip archive looks damaged.");
    const method = dir.getUint16(p + 10, true);
    let compressedSize = dir.getUint32(p + 20, true);
    let size = dir.getUint32(p + 24, true);
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    let offset = dir.getUint32(p + 42, true);
    const name = decoder.decode(bytes(dir, p + 46, nameLength));

    if (compressedSize === MAX || size === MAX || offset === MAX) {
      // Zip64 extra field (id 1) holds the real values, in this order, for
      // whichever of them overflowed.
      let e = p + 46 + nameLength;
      const end = e + extraLength;
      while (e + 4 <= end) {
        const id = dir.getUint16(e, true);
        const length = dir.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (size === MAX) {
            size = Number(dir.getBigUint64(q, true));
            q += 8;
          }
          if (compressedSize === MAX) {
            compressedSize = Number(dir.getBigUint64(q, true));
            q += 8;
          }
          if (offset === MAX) offset = Number(dir.getBigUint64(q, true));
        }
        e += 4 + length;
      }
    }
    entries.push({ name, method, compressedSize, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extract(blob: Blob, entry: Entry): Promise<Uint8Array> {
  const header = await read(blob, entry.offset, entry.offset + 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER) throw new Error(`Couldn't read ${entry.name} from the zip.`);
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = new Uint8Array(await blob.slice(start, start + entry.compressedSize).arrayBuffer());
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data);
  throw new Error(`${entry.name} uses a zip compression method Keeper can't read.`);
}

/** Returns the text of every entry whose path passes `match`. */
export async function readZipText(blob: Blob, match: (path: string) => boolean): Promise<{ name: string; text: string }[]> {
  const decoder = new TextDecoder();
  const wanted = (await listEntries(blob)).filter((e) => !e.name.endsWith("/") && match(e.name));
  const files = [];
  for (const entry of wanted) files.push({ name: entry.name, text: decoder.decode(await extract(blob, entry)) });
  return files;
}

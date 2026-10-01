// A small ZIP writer and reader on node:zlib, without dependencies. Enough for packaging the extension:
// deflated entries, UTF-8 names with forward slashes, no directories, no ZIP64 (the package is a few hundred KB).
// Windows' own zip tools are avoided on purpose: entry names with backslashes are a known way to produce a
// package that other tools read as one flat list of oddly named files.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32 } from './png.mjs';

/** A fixed timestamp (1980-01-01 00:00), so the same input always gives the same archive. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

/**
 * Builds a ZIP archive. `entries` is a list of `{ name, data }` with forward-slash names relative to the
 * archive root; they are written sorted by name.
 */
export function writeZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`bad entry name: ${name}`);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(UTF8_NAMES, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42); // extra, comment, disk, attributes stay 0
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Reads an archive written by `writeZip` back into `{ name, data }` entries, checking every CRC. */
export function readZip(buf) {
  const end = buf.length - 22;
  if (end < 0 || buf.readUInt32LE(end) !== 0x06054b50) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const crc = buf.readUInt32LE(p + 16);
    const packedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + packedSize));
    if (data.length !== size || crc32(data) !== crc) throw new Error(`corrupt entry ${name}`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

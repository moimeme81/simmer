'use strict';
/**
 * A small ZIP reader and writer on node:zlib, so exports and imports need no extra package
 * (changing package.json would stop the automatic updater). Supports stored and deflated entries, not ZIP64 or encryption.
 */
const zlib = require('node:zlib');

const MAX_ENTRIES = 20000;
const MAX_UNPACKED = 1024 * 1024 * 1024;   // 1 GB in total, a guard against zip bombs

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Buffer | string }] -> Buffer */
function writeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw, method = useDeflate ? 8 : 0, crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);   // 0x0800: names are UTF-8
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

const isZip = (buf) => buf.length > 22 && buf.readUInt32LE(0) === 0x04034b50;

/** Buffer -> [{ name, read() }]. Directories are left out. Throws on a broken archive. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('This archive has too many files');
  let p = buf.readUInt32LE(eocd + 16), total = 0;
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The ZIP file is damaged');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || /(^|\/)\.\.(\/|$)/.test(name)) continue;
    if (flags & 1) throw new Error('This ZIP file is password protected');
    total += usize;
    if (total > MAX_UNPACKED) throw new Error('This archive is too large to unpack');
    out.push({
      name, size: usize,
      read() {
        if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('The ZIP file is damaged');
        const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
        const body = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(body);
        if (method === 8) return zlib.inflateRawSync(body, { maxOutputLength: Math.max(usize, 1) + 1024 });
        throw new Error('This ZIP file uses an unsupported compression');
      },
    });
  }
  return out;
}

module.exports = { writeZip, readZip, isZip, crc32 };

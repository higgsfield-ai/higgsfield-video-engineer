// Image writers: 16-bit RGB PNG (own encoder over node:zlib) and PFM (linear float RGB).
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** rgba16 packed as u32 pairs (r | g<<16, b | a<<16) from the GPU -> 16-bit RGB PNG */
export function writePNG16(file, W, H, packed) {
  const src = new Uint16Array(packed);
  const stride = W * 6 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 1; // Sub filter
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c], o = y * stride + 1 + x * 6 + c * 2;
        raw[o] = v >>> 8; raw[o + 1] = v & 0xff; // big-endian samples
      }
    }
    // apply Sub filter bytewise (bpp = 6)
    for (let x = stride - 1; x >= 7; x--) raw[y * stride + x] = (raw[y * stride + x] - raw[y * stride + x - 6]) & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 16; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/** linear float RGBA (vec4f per pixel, top-down) -> PFM (RGB, little endian, bottom-up) */
export function writePFM(file, W, H, rgba) {
  const f = new Float32Array(rgba);
  const header = Buffer.from(`PF\n${W} ${H}\n-1.0\n`, 'ascii');
  const body = Buffer.alloc(W * H * 12);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 12;
    body.writeFloatLE(f[s], d); body.writeFloatLE(f[s + 1], d + 4); body.writeFloatLE(f[s + 2], d + 8);
  }
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

/** 8-bit RGB PNG from a Uint8Array (W*H*3) — used for baked textures */
export function writePNG8(file, W, H, rgb) {
  const stride = W * 3 + 1, raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) { raw[y * stride] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * stride + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

/** depth AOV: guide buffer (vec4f per pixel: mean normal xyz, mean camera-ray distance w; top-down) -> greyscale PFM "Pf" of w
 *  (metres along the primary ray, 1e4 = sky/miss; little endian, bottom-up) */
export function writeDepthPFM(file, W, H, guide) {
  const f = new Float32Array(guide);
  const header = Buffer.from(`Pf\n${W} ${H}\n-1.0\n`, 'ascii');
  const body = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) body.writeFloatLE(f[((H - 1 - y) * W + x) * 4 + 3], (y * W + x) * 4);
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

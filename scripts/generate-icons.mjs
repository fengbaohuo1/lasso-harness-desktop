#!/usr/bin/env node
/**
 * 生成桌面壳占位图标集（无第三方依赖，纯 Node 手工编码 PNG/ICO/ICNS）：
 *   src-tauri/icons/32x32.png        32x32
 *   src-tauri/icons/128x128.png      128x128
 *   src-tauri/icons/128x128@2x.png   256x256
 *   src-tauri/icons/icon.png         512x512
 *   src-tauri/icons/icon.ico         Windows（内嵌 32/128/256 PNG 条目）
 *   src-tauri/icons/icon.icns        macOS（ic07/ic08/ic09/ic10 PNG 块）
 *
 * 图案：靛蓝圆角方块 + 白色 ">" 尖角（终端提示符意象）。发布前可换正式图标：
 *   npx tauri icon path/to/icon-1024.png
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const iconDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "src-tauri", "icons");

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** pixelFn(x, y) -> [r, g, b, a] */
function encodePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: None
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 图案 ----------
const INDIGO = [79, 70, 229]; // #4F46E5
const WHITE = [255, 255, 255];

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawIcon(size) {
  const radius = size * 0.22;
  const stroke = Math.max(2, size * 0.09);
  // ">" 尖角的三个顶点（占位比例）
  const p1 = [size * 0.32, size * 0.28];
  const p2 = [size * 0.62, size * 0.5];
  const p3 = [size * 0.32, size * 0.72];

  return (x, y) => {
    // 圆角矩形 alpha
    const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
    const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
    const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius;
    if (!inside) return [0, 0, 0, 0];

    const onChevron =
      distanceToSegment(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]) <= stroke ||
      distanceToSegment(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]) <= stroke;
    return onChevron ? [...WHITE, 255] : [...INDIGO, 255];
  };
}

// ---------- ICO（PNG 条目，Vista+） ----------
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directorySize = 16 * entries.length;
  let offset = 6 + directorySize;
  const directory = [];
  const payloads = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width
    entry[1] = size >= 256 ? 0 : size; // height
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    directory.push(entry);
    payloads.push(png);
  }
  return Buffer.concat([header, ...directory, ...payloads]);
}

// ---------- ICNS（PNG 块） ----------
function encodeIcns(chunks) {
  const body = Buffer.concat(
    chunks.map(({ type, png }) => {
      const header = Buffer.alloc(8);
      header.write(type, 0, "ascii");
      header.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([header, png]);
    }),
  );
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// ---------- 输出 ----------
mkdirSync(iconDir, { recursive: true });

const sizes = [32, 128, 256, 512, 1024];
const pngBySize = new Map(sizes.map((size) => [size, encodePng(size, drawIcon(size))]));

writeFileSync(join(iconDir, "32x32.png"), pngBySize.get(32));
writeFileSync(join(iconDir, "128x128.png"), pngBySize.get(128));
writeFileSync(join(iconDir, "128x128@2x.png"), pngBySize.get(256));
writeFileSync(join(iconDir, "icon.png"), pngBySize.get(512));
writeFileSync(
  join(iconDir, "icon.ico"),
  encodeIco([
    { size: 32, png: pngBySize.get(32) },
    { size: 128, png: pngBySize.get(128) },
    { size: 256, png: pngBySize.get(256) },
  ]),
);
writeFileSync(
  join(iconDir, "icon.icns"),
  encodeIcns([
    { type: "ic07", png: pngBySize.get(128) }, // 128x128
    { type: "ic08", png: pngBySize.get(256) }, // 256x256
    { type: "ic09", png: pngBySize.get(512) }, // 512x512
    { type: "ic10", png: pngBySize.get(1024) }, // 1024x1024
  ]),
);

console.log(`[icons] 已生成图标集：${iconDir}`);

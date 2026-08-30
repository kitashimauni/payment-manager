import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const background = [23, 35, 45, 255];
const accent = [228, 87, 69, 255];
const foreground = [255, 253, 248, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function png(width) {
  const pixels = Buffer.alloc(width * width * 4);
  const center = width / 2;
  const radius = width * 0.31;
  const lineWidth = width * 0.055;

  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= width) return;
    const offset = (y * width + x) * 4;
    pixels.set(color, offset);
  };

  const distanceToSegment = (x, y, x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
    return Math.hypot(x - (x1 + projection * dx), y - (y1 + projection * dy));
  };

  const drawLine = (x1, y1, x2, y2) => {
    const minX = Math.floor(Math.min(x1, x2) - lineWidth);
    const maxX = Math.ceil(Math.max(x1, x2) + lineWidth);
    const minY = Math.floor(Math.min(y1, y2) - lineWidth);
    const maxY = Math.ceil(Math.max(y1, y2) + lineWidth);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2) <= lineWidth / 2) setPixel(x, y, foreground);
      }
    }
  };

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, background);
      if (Math.hypot(x + 0.5 - center, y + 0.5 - center) <= radius) setPixel(x, y, accent);
    }
  }

  drawLine(center, center - width * 0.18, center, center + width * 0.2);
  drawLine(center - width * 0.17, center - width * 0.14, center, center + width * 0.02);
  drawLine(center + width * 0.17, center - width * 0.14, center, center + width * 0.02);
  drawLine(center - width * 0.16, center + width * 0.08, center + width * 0.16, center + width * 0.08);
  drawLine(center - width * 0.16, center + width * 0.17, center + width * 0.16, center + width * 0.17);

  const scanlines = Buffer.alloc((width * 4 + 1) * width);
  for (let y = 0; y < width; y += 1) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, png(size));

/**
 * Generate the PWA icons.
 *
 * A tiny hand-rolled PNG encoder rather than a dependency: the icon is a few
 * rectangles, and pulling in an image library to draw three bars would be a
 * poor trade. Run with `node scripts/make-icons.mjs`.
 *
 * The mark: three bars of unequal height on a dark ground — capacity, with one
 * column overflowing. It reads at 16px, which is the only size that matters
 * for a tab.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BACKGROUND = [23, 23, 23]; // neutral-900
const BAR = [250, 250, 250]; // neutral-50
const OVER = [239, 68, 68]; // red-500 — the bar that does not fit

function crc32(buffer) {
	let table = crc32.table;
	if (!table) {
		table = crc32.table = new Int32Array(256);
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[i] = c;
		}
	}
	let crc = -1;
	for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
	return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** Encode RGB pixel data (width*height*3) as a PNG. */
function encodePng(width, height, rgb) {
	const raw = Buffer.alloc(height * (width * 3 + 1));
	for (let y = 0; y < height; y++) {
		raw[y * (width * 3 + 1)] = 0; // filter: none
		rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/**
 * @param size    pixel dimensions
 * @param padding fraction of the icon kept clear at the edges. Maskable icons
 *                get a generous margin because the launcher may crop to a
 *                circle.
 */
function drawIcon(size, padding) {
	const rgb = Buffer.alloc(size * size * 3);
	const put = (x, y, [r, g, b]) => {
		const i = (y * size + x) * 3;
		rgb[i] = r;
		rgb[i + 1] = g;
		rgb[i + 2] = b;
	};

	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, BACKGROUND);

	const inset = Math.round(size * padding);
	const usable = size - inset * 2;
	const barWidth = Math.round(usable / 5);
	const gap = Math.round((usable - barWidth * 3) / 2);
	const baseline = size - inset;

	// Three bars; the third overflows past where the others stop.
	const heights = [0.45, 0.7, 1.0];
	heights.forEach((fraction, index) => {
		const height = Math.round(usable * fraction);
		const left = inset + index * (barWidth + gap);
		const colour = index === 2 ? OVER : BAR;
		for (let y = baseline - height; y < baseline; y++) {
			for (let x = left; x < left + barWidth; x++) {
				if (x >= 0 && x < size && y >= 0 && y < size) put(x, y, colour);
			}
		}
	});

	return encodePng(size, size, rgb);
}

mkdirSync('static', { recursive: true });
writeFileSync('static/icon-192.png', drawIcon(192, 0.16));
writeFileSync('static/icon-512.png', drawIcon(512, 0.16));
writeFileSync('static/icon-maskable-512.png', drawIcon(512, 0.26));
console.log('wrote static/icon-192.png, icon-512.png, icon-maskable-512.png');

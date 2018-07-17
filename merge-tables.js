"use strict";

const crypto = require("crypto");
const fs = require("fs-extra");

module.exports = async function main(input, output) {
	const fonts = [];
	for (const file of input) fonts.push(await readFont(file));

	const { offsetMap, bodyBuffer } = shareTables(fonts);
	const ttcBuf = createTTC(fonts, offsetMap, bodyBuffer);
	await fs.writeFile(output, ttcBuf);
};

function createTTC(fonts, offsetMap, bodyBuffer) {
	const ttcHeaderLength = 12 + 4 * fonts.length;
	const offsetTableLengths = fonts.map(f => 12 + 16 * f.tables.length);
	const initialLength = offsetTableLengths.reduce((a, b) => a + b, ttcHeaderLength);

	const initial = new ArrayBuffer(initialLength);
	const ttcHeader = new DataView(initial, 0);
	ttcHeader.setUint32(0, fromTag("ttcf"), false);
	ttcHeader.setUint16(4, 1, false);
	ttcHeader.setUint16(6, 0, false);
	ttcHeader.setUint32(8, fonts.length, false);

	let currentOffsetTableOffset = ttcHeaderLength;
	for (let j = 0; j < fonts.length; j++) {
		const font = fonts[j];
		ttcHeader.setUint32(12 + 4 * j, currentOffsetTableOffset, false);
		const offsetTable = new DataView(initial, currentOffsetTableOffset, offsetTableLengths[j]);
		currentOffsetTableOffset += offsetTableLengths[j];

		offsetTable.setUint32(0, font.sfntVersion, false);
		offsetTable.setUint16(4, font.numTables, false);
		offsetTable.setUint16(6, font.searchRange, false);
		offsetTable.setUint16(8, font.entrySelector, false);
		offsetTable.setUint16(10, font.rangeShift, false);

		for (let k = 0; k < font.tables.length; k++) {
			const table = font.tables[k];
			const tableRecordOffset = 12 + 16 * k;
			offsetTable.setUint32(tableRecordOffset + 0, fromTag(table.tag), false);
			offsetTable.setUint32(tableRecordOffset + 4, table.checksum, false);
			offsetTable.setUint32(
				tableRecordOffset + 8,
				initialLength + offsetMap.get(table.hash),
				false
			);
			offsetTable.setUint32(tableRecordOffset + 12, table.length, false);
		}
	}
	return Buffer.concat([Buffer.from(initial), bodyBuffer]);
}

function shareTables(fonts) {
	let tableMap = new Map();
	for (let j = 0; j < fonts.length; j++) {
		const font = fonts[j];
		// cleanup data
		font.numTables = font.tables.length;
		font.searchRange = Math.pow(2, Math.floor(Math.log(font.numTables) / Math.LN2)) * 16;
		font.entrySelector = Math.floor(Math.log(font.numTables) / Math.LN2);
		font.rangeShift = font.numTables * 16 - font.searchRange;
		font.tables = font.tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

		for (let table of font.tables) {
			table.length = table.buffer.byteLength;
			table.buffer = padLong(table.buffer);
			const hash =
				table.tag +
				"/" +
				crypto
					.createHash("sha256")
					.update(Buffer.from(table.buffer))
					.digest("hex");
			if (tableMap.has(hash)) {
				table.buffer = tableMap.get(hash);
			} else {
				tableMap.set(hash, table.buffer);
			}
			let checksum = 0;
			const view = new DataView(table.buffer);
			for (let j = 0; j * 4 < table.buffer.byteLength; j++) {
				checksum = (checksum + view.getUint32(4 * j)) % 0x100000000;
			}
			table.hash = hash;
			table.checksum = checksum;
		}
	}
	let offset = 0;
	let offsetMap = new Map();
	let bodyBlocks = [];
	for (let [hash, content] of tableMap) {
		offsetMap.set(hash, offset);
		offset += content.byteLength;
		bodyBlocks.push(Buffer.from(content));
	}
	return { offsetMap, bodyBuffer: Buffer.concat(bodyBlocks) };
}

function padLong(ab) {
	if (ab.byteLength % 4 === 0) return ab;
	const raw = Array.from(new Uint8Array(ab));
	while (raw.length % 4) raw.push(0);
	return new Uint8Array(raw).buffer;
}

/**
 * @returns {string}
 * @param {number} x
 */
function toTag(x) {
	return (
		String.fromCharCode((x >>> 24) & 0xff) +
		String.fromCharCode((x >>> 16) & 0xff) +
		String.fromCharCode((x >>> 8) & 0xff) +
		String.fromCharCode((x >>> 0) & 0xff)
	);
}

/**
 * @returns {number}
 * @param {string} x
 */
function fromTag(x) {
	return (
		(x.charCodeAt(0) & 0xff) * 256 * 256 * 256 +
		(x.charCodeAt(1) & 0xff) * 256 * 256 +
		(x.charCodeAt(2) & 0xff) * 256 +
		(x.charCodeAt(3) & 0xff)
	);
}

/**
 * @param {ArrayBuffer} buf
 * @param {DataView} view
 * @param {number} offset
 */
function readTableRecord(buf, view, offset) {
	const tableOffset = view.getUint32(offset + 8, false);
	const tableLength = view.getUint32(offset + 12, false);
	return {
		tag: toTag(view.getUint32(offset + 0, false)),
		buffer: buf.slice(tableOffset, tableOffset + tableLength)
	};
}

async function readFont(path) {
	const ab = new Uint8Array(await fs.readFile(path)).buffer;
	const view = new DataView(ab);

	const font = {
		sfntVersion: view.getUint32(0, false),
		numTables: view.getUint16(4, false),
		searchRange: view.getUint16(6, false),
		entrySelector: view.getUint16(8, false),
		rangeShift: view.getUint16(10, false),
		tables: [],
		glyphs: []
	};
	for (let j = 0; j < font.numTables; j++) {
		font.tables[j] = readTableRecord(ab, view, 12 + j * 16);
	}
	return font;
}

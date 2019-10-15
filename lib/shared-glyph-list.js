const GlyphClass = require("./glyph-class");
const JsonUtil = require("./json-util");

class Entry {
	constructor(glyph, glyphClass, ix, n) {
		// We use a compressed representation to store glyphs -- to save memory, of course
		this.glyphRep = Buffer.from(JSON.stringify(glyph), "utf-8");
		this.glyphClass = glyphClass;
		this.firstInstID = ix;
		this.firstInstGID = n;
		this.used = new Set([ix]);
	}
	compareTo(that) {
		if (this.glyphClass === that.glyphClass) {
			return this.firstInstID === that.firstInstID
				? this.firstInstGID - that.firstInstGID
				: this.firstInstID - that.firstInstID;
		} else {
			return this.glyphClass - that.glyphClass;
		}
	}
	getGlyph() {
		return JSON.parse(this.glyphRep.toString("utf-8"));
	}
	setGlyph(glyph) {
		this.glyphRep = Buffer.from(JSON.stringify(glyph), "utf-8");
	}
	[JsonUtil.JsonStringify]() {
		return this.glyphRep;
	}
}

module.exports = class SharedGlyphList {
	constructor() {
		this.glyphMap = new Map();
	}
	add(gid, gIndex, fontIndex, glyph, cw) {
		const existing = this.glyphMap.get(gid);
		if (existing) {
			if (existing.used.has(fontIndex)) {
				throw new Error(`Duplicate GID found in font #${fontIndex}: ${gid}`);
			}
			existing.used.add(fontIndex);
			return existing;
		} else {
			const novel = new Entry(
				glyph,
				GlyphClass.decideGlyphClass(glyph, gIndex, cw),
				fontIndex,
				gIndex
			);
			this.glyphMap.set(gid, novel);
			return novel;
		}
	}
	addPostSpacePad(fontCount) {
		// In gap mode, we must ensure that a all-used glyph is right after all the spaces
		// since in TTF, spaces do not occupy GLYF space.
		// Try find a glyph that exists in all the sub-fonts and is not a space
		this.sort();
		for (const [gid, entry] of this.glyphMap) {
			if (entry.glyphClass > GlyphClass.PostSpacePad && entry.used.size === fontCount) {
				entry.glyphClass = GlyphClass.PostSpacePad;
				return;
			}
		}

		// If we cannot find one, insert a glyph to it
		const gid = ".otfcc-ttcize!postSpacePad";
		const novel = new Entry(
			{ advanceWidth: 0, contours: [[{ x: 0, y: 0, on: true }]], references: [] },
			GlyphClass.PostSpacePad,
			0,
			0
		);
		for (let j = 0; j < fontCount; j++) novel.used.add(j);
		this.glyphMap.set(gid, novel);
	}
	*entries() {
		return this.glyphMap.entries();
	}
	sort() {
		const glyphList = [...this.glyphMap].sort((a, b) => a[1].compareTo(b[1]));
		this.glyphMap = new Map(glyphList);
	}
	extract(f) {
		const glyph_order = [];
		const glyf = {};
		for (const [gid, entry] of this.glyphMap) {
			if (f(entry)) {
				glyph_order.push(gid);
				glyf[gid] = entry;
			}
		}
		return { glyph_order, glyf };
	}
	extractShareMap(fontCount) {
		let sharing = [];
		for (let fid = 0; fid < fontCount; fid++) {
			sharing[fid] = [];
		}
		let gIndex = 0;
		for (const [gid, entry] of this.glyphMap) {
			for (let fid = 0; fid < fontCount; fid++) {
				if (entry.used.has(fid)) {
					sharing[fid].push(gIndex);
				}
			}
			gIndex++;
		}

		return sharing;
	}
};

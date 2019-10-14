const GlyphClass = require("./glyph-class");

class Entry {
	constructor(glyph, widthClass, ix, n) {
		this.glyph = glyph;
		this.widthClass = widthClass;
		this.firstInstID = ix;
		this.firstInstGID = n;
		this.used = new Set([ix]);
	}
	compareTo(that) {
		if (this.widthClass === that.widthClass) {
			return this.firstInstID === that.firstInstID
				? this.firstInstGID - that.firstInstGID
				: this.firstInstID - that.firstInstID;
		} else {
			return this.widthClass - that.widthClass;
		}
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
				glyf[gid] = entry.glyph;
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

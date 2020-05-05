module.exports = class HintPadder {
	constructor() {
		this.maxCvt = 0;
	}
	updateCvtLength(cvt) {
		if (!cvt) return;
		this.maxCvt = Math.max(this.maxCvt, cvt.length || 0);
	}
	padGlyphInstructions(fontsLength, entry) {
		if (!entry) return;
		if (entry.used.size === fontsLength) return;

		const glyph = entry.getGlyph();
		if (!glyph || !glyph.instructions) return;

		let head = [];
		let started = false;
		for (const usageFontId of entry.used) {
			head.push("PUSHW_2", usageFontId, this.maxCvt, "RCVT", "EQ");
			if (started) head.push("OR");
			started = true;
		}

		glyph.instructions = [...head, "IF", ...glyph.instructions, "EIF"];

		entry.setGlyph(glyph);
	}
	padCvt(cvt, fontIndex) {
		if (!cvt) return;
		while (cvt.length < this.maxCvt) {
			cvt.push(0);
		}
		cvt[this.maxCvt] = fontIndex;
	}
	padMaxp(maxp, fontCount) {
		if (!maxp) return;
		maxp.maxStackElements += 2 * fontCount;
	}
	padPrep(prep, fontIndex) {
		if (!prep) return;
		prep.push("PUSHW_2", this.maxCvt, fontIndex, "WCVTP");
	}
};

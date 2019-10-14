const fs = require("fs-extra");
const path = require("path");
const temp = require("temp");
const spawn = require("child-process-promise").spawn;
const which = require("which");

const ReverseGidMap = require("./reverse-gid-map");
const SharedGlyphList = require("./shared-glyph-list");

const { Workflow, introduce, build } = require("megaminx");

const mergeTables = require("./merge-tables");

const argv = require("yargs")
	.describe("h", "Wrap hints hints")
	.boolean("h")
	.describe("x", "Gap mode")
	.boolean("x").argv;

const DoHintWrapping = !!(argv.h && !argv.x);
const GapMode = !!argv.x;

main().catch(e => console.error(e));

///////////////////////////////////////////////////////////////////////////////////////////////////

class HintPadder {
	constructor() {
		this.maxCvt = 0;
	}
	updateCvt(cvt) {
		if (!cvt) return;
		this.maxCvt = Math.max(this.maxCvt, cvt.length || 0);
	}
	padGlyphInstructions(fontsLength, entry) {
		if (!entry || !entry.glyph || !entry.glyph.instructions) return;
		if (entry.used.size === fontsLength) return;

		let head = [];
		let started = false;
		for (const usageFontId of entry.used) {
			head.push("PUSHW_2", usageFontId, this.maxCvt, "RCVT", "EQ");
			if (started) head.push("OR");
			started = true;
		}

		entry.glyph.instructions = [...head, "IF", ...entry.glyph.instructions, "EIF"];
	}
	padCvt(cvt) {
		if (!cvt) return;
		while (f.cvt_.length < this.maxCvt) {
			f.cvt_.push(0);
		}
		f.cvt_[this.maxCvt] = f.$ix;
	}
	padMaxp(maxp, fontCount) {
		if (!maxp) return;
		maxp.maxStackElements += 2 * fontCount;
	}
	padPrep(prep, fontIndex) {
		if (!prep) return;
		prep.push("PUSHW_2", this.maxCvt, fontIndex, "WCVTP");
	}
}

// Pass 1 : collect glyphs in the input fonts
async function collectGlyphs(ctx) {
	const glyphs = new SharedGlyphList();
	let fontCount = 0;
	const padder = new HintPadder();

	for (let f of argv._) {
		process.stderr.write(`Introducing font ${f}\n`);
		const font = await ctx.run(introduce, "$" + fontCount, {
			from: f,
			nameByHash: true
		});
		const revGidMap = ReverseGidMap(font.glyph_order);
		for (let g in font.glyf) {
			const gIndex = revGidMap.get(g);
			glyphs.add(g, gIndex, fontCount, font.glyf[g], font.head.unitsPerEm);
		}
		if (global.gc) global.gc();

		if (DoHintWrapping) padder.updateCvt(font.cvt_);
		f.glyf = {}; // Set font glyphs set to empty
		font.$ix = fontCount;
		fontCount += 1;
	}
	if (DoHintWrapping) {
		for (const [g, entry] of glyphs.entries()) {
			padder.padGlyphInstructions(fontCount, entry);
		}
	}
	if (GapMode) glyphs.addPostSpacePad(fontCount);
	glyphs.sort();

	for (let fid in ctx.items) {
		let font = ctx.items[fid];
		const fontIndex = font.$ix;
		const extractor = GapMode ? entry => entry.used.has(fontIndex) : entry => true;
		const extracted = glyphs.extract(extractor);

		font.glyf = extracted.glyf;
		font.glyph_order = extracted.glyph_order;

		if (DoHintWrapping) {
			padder.padCvt(font.cvt_);
			padder.padMaxp(font.maxp, fontCount);
			padder.padPrep(font.prep, fontIndex);
		}
	}
	const shareMap = glyphs.extractShareMap(fontCount);
	return { ctx, shareMap };
}

async function buildOTD(ctx, tempDir, prefix) {
	let otdPaths = [];
	for (let fid in ctx.items) {
		const pOTD = prefix
			? prefix + "." + otdPaths.length + ".otd"
			: temp.path({ dir: tempDir, suffix: ".otd" });
		await ctx.run(build, fid, { to: pOTD });
		ctx.remove(fid);
		if (global.gc) global.gc();
		otdPaths.push(pOTD);
	}

	return otdPaths;
}

// Pass 2 : build TTC files
async function buildOtf(otdPaths, tempDir) {
	// build OTF
	let paths = [];
	for (let pOTD of otdPaths) {
		const pOTF = temp.path({ dir: tempDir, suffix: ".otf" });
		await spawn(
			which.sync("otfccbuild"),
			[pOTD, "-o", pOTF, "-k", "--subroutinize", "--keep-average-char-width", "--quiet"],
			{
				stdio: "inherit"
			}
		);
		await fs.remove(pOTD);
		paths.push(pOTF);
	}
	return paths;
}
async function buildTtc(sharing, paths, output) {
	// build TTC
	await mergeTables(paths, output, GapMode ? sharing : null);
	await Promise.all(paths.map(p => fs.remove(p)));
}

async function main() {
	if (!argv.prefix && !argv.o) throw new Error("Must specify an output.");
	if (GapMode && !argv.o) throw new Error("Must use -o in gap mode.");
	if (!argv._.length) throw new Error("Must have at least one input.");

	const tempDir = path.dirname(path.resolve(argv.prefix || argv.o));
	await fs.ensureDir(tempDir);

	const sh = await collectGlyphs(new Workflow({}));
	const otdFiles = await buildOTD(sh.ctx, tempDir, argv.prefix);

	if (argv.o) {
		if (global.gc) global.gc();
		const paths = await buildOtf(otdFiles, tempDir);
		await buildTtc(sh.shareMap, paths, argv.o);
	}
}

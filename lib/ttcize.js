const fs = require("fs-extra");
const path = require("path");
const temp = require("temp");
const spawn = require("child-process-promise").spawn;

const ReverseGidMap = require("./reverse-gid-map");
const SharedGlyphList = require("./shared-glyph-list");
const JsonUtil = require("./json-util");
const GetConfig = require("./config");
const HintPadder = require("./hint-pad");
const MergeTables = require("./merge-tables");
const GlyphClass = require("./glyph-class");
const Rank = require("./rank");

const argv = require("yargs")
	.describe("h", "Wrap hints")
	.boolean("h")
	.describe("x", "Gap mode")
	.boolean("x")
	.describe("common-width", "Most common glyph width")
	.number("common-width")
	.describe("common-height", "Most common glyph height")
	.number("common-height")
	.describe("otfccdump-command", "Set the path of otfccdump executable")
	.string("otfccdump-command")
	.describe("otfccbuild-command", "Set the path of otfccbuild executable")
	.string("otfccbuild-command").argv;

const Config = GetConfig(argv);

main().catch(e => console.error(e));

///////////////////////////////////////////////////////////////////////////////////////////////////

async function main() {
	if (!argv.prefix && !argv.o) throw new Error("Must specify an output.");
	if (Config.gapMode && !argv.o) throw new Error("Must use -o in gap mode.");
	if (!argv._.length) throw new Error("Must have at least one input.");

	const tempDir = path.dirname(path.resolve(argv.prefix || argv.o));
	await fs.ensureDir(tempDir);

	const sh = await collectGlyphs(tempDir);
	const otdFiles = await buildOTD(sh.fonts, tempDir, argv.prefix);

	if (argv.o) {
		if (global.gc) global.gc();
		const buffers = await buildOtf(otdFiles, tempDir);
		await buildTtc(sh.shareMap, buffers, argv.o);
	}
}

async function collectGlyphs(tempDir) {
	const fonts = [];
	const glyphs = new SharedGlyphList();
	const padder = new HintPadder();

	const shapeHintResolver = new Rank.ShapeHintResolver();

	for (let f of argv._) {
		process.stderr.write(`Introducing font ${f}\n`);
		const font = await loadFont(f, tempDir);

		const fontIndex = fonts.length;
		const rf = new Rank.RankFactory(shapeHintResolver, fontIndex, font);

		const revGidMap = ReverseGidMap(font.glyph_order);
		for (let g in font.glyf) {
			const glyph = font.glyf[g];
			const gIndex = revGidMap.get(g);
			const rank = rf.decideForGlyph(gIndex, g);
			const gk = GlyphClass.decideGlyphClass(
				font.glyf[g],
				gIndex,
				Config.commonWidth,
				Config.commonHeight
			);

			font.glyf[g] = glyphs.add(g, glyph, gk, rank, fontIndex);
		}
		if (global.gc) global.gc();

		if (Config.doHintWrapping) padder.updateCvtLength(font.cvt_);
		fonts.push(font);
	}
	if (Config.doHintWrapping) {
		for (const [g, entry] of glyphs.entries()) {
			padder.padGlyphInstructions(fonts.length, entry);
		}
	}
	if (Config.gapMode) glyphs.addPostSpacePad(fonts.length);
	glyphs.sort();

	for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
		const font = fonts[fontIndex];
		const extractor = Config.gapMode ? entry => entry.used.has(fontIndex) : entry => true;
		const extracted = glyphs.extract(extractor);

		font.glyf = extracted.glyf;
		font.glyph_order = extracted.glyph_order;

		if (Config.doHintWrapping) {
			padder.padCvt(font.cvt_, fontIndex);
			padder.padMaxp(font.maxp, fonts.length);
			padder.padPrep(font.prep, fontIndex);
		}
	}
	const shareMap = glyphs.extractShareMap(fonts.length);
	return { fonts, shareMap };
}

///////////////////////////////////////////////////////////////////////////////////////////////////

async function loadFont(input, tempDir) {
	const pOtd = temp.path({ dir: tempDir, suffix: ".otd" });
	await spawn(
		Config.dumpCommand,
		[input, "-o", pOtd, "--name-by-hash", "--no-bom", "--decimal-cmap", "--quiet"],
		{ stdio: "inherit" }
	);
	const otdStream = await fs.createReadStream(pOtd);
	const font = await JsonUtil.parseJsonObjectFromStream(otdStream);
	await fs.remove(pOtd);
	return font;
}

async function buildOTD(fonts, tempDir, prefix) {
	let otdPaths = [];
	for (let fid = 0; fid < fonts.length; fid++) {
		const font = fonts[fid];
		const pOtd = prefix
			? prefix + "." + otdPaths.length + ".otd"
			: temp.path({ dir: tempDir, suffix: ".otd" });

		const out = fs.createWriteStream(pOtd);
		await JsonUtil.fontJsonStringifyToStream(font, out);

		fonts[fid] = null;
		if (global.gc) global.gc();
		otdPaths.push(pOtd);
	}

	return otdPaths;
}

async function buildOtf(otdPaths, tempDir) {
	// build OTF
	let buffers = [];
	for (let pOTD of otdPaths) {
		const pOTF = temp.path({ dir: tempDir, suffix: ".otf" });
		await spawn(
			Config.buildCommand,
			[pOTD, "-o", pOTF, "-k", "--subroutinize", "--keep-average-char-width", "--quiet"],
			{ stdio: "inherit" }
		);
		buffers.push(await fs.readFile(pOTF));
		await fs.remove(pOTD);
		await fs.remove(pOTF);
	}
	return buffers;
}

async function buildTtc(sharing, buffers, output) {
	await MergeTables.merge(buffers, output, Config.gapMode ? sharing : null);
}

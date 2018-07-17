const fs = require("fs-extra");
const path = require("path");
const temp = require("temp");
const spawn = require("child-process-promise").spawn;
const which = require("which");

const { Workflow, introduce, build } = require("megaminx");

const mergeTables = require("./merge-tables");

const argv = require("yargs")
	.describe("h", "merge hints")
	.boolean("h")
	.boolean("k").argv;

class GMAPEntry {
	constructor(widthClass, ix, n) {
		this.widthClass = widthClass;
		this.firstInstID = ix;
		this.firstInstGID = n;
		this.used = [ix];
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

const FULLWIDTH = 1;
const COMPONENT = 2;

// Pass 1 : collect glyphs in the input fonts
async function collectGlyphs(ctx) {
	let glyf = {};
	let gmap = {};
	let ix = 0;
	let maxcvt = 0;

	for (let f of argv._) {
		const font = await ctx.run(introduce, "$" + ix, {
			from: f,
			nameByHash: true
		});
		let n = 0;
		for (let gid in font.glyf) {
			if (!glyf[gid]) {
				glyf[gid] = font.glyf[gid];
				let widthClass = 0;
				if (argv.k && n > 1) {
					if (
						glyf[gid].advanceWidth === font.head.unitsPerEm &&
						glyf[gid].advanceHeight === font.head.unitsPerEm
					) {
						widthClass = FULLWIDTH;
					}
				}
				gmap[gid] = new GMAPEntry(widthClass, ix, n);
			} else {
				font.glyf[gid] = glyf[gid];
				gmap[gid].used.push(ix);
			}
			n += 1;
		}
		font.glyf = glyf;
		if (global.gc) global.gc();

		if (argv.h && font.cvt_) {
			maxcvt = Math.max(font.cvt_.length, maxcvt);
		}
		font.$ix = ix;
		ix += 1;
	}
	let keys = Object.keys(gmap).sort((a, b) => gmap[a].compareTo(gmap[b]));
	if (argv.h) {
		for (let g in glyf) {
			if (!glyf[g] || !gmap[g] || !glyf[g].instructions) continue;
			if (gmap[g].used.length === ix) continue;
			let head = [];
			for (let j = 0; j < gmap[g].used.length; j++) {
				let ixj = gmap[g].used[j];
				head.push("PUSHW_2", ixj, maxcvt, "RCVT", "EQ");
				if (j > 0) head.push("OR");
			}
			glyf[g].instructions = [...head, "IF", ...glyf[g].instructions, "EIF"];
		}
	}
	for (let fid in ctx.items) {
		let f = ctx.items[fid];
		f.glyph_order = keys;
		if (argv.h && f.cvt_) {
			while (f.cvt_.length < maxcvt) {
				f.cvt_.push(0);
			}
			f.cvt_[maxcvt] = f.$ix;
		}
		if (argv.h && f.maxp) {
			f.maxp.maxStackElements += 2;
		}
		if (argv.h && f.prep) {
			f.prep.push(
				"PUSHW_2",
				maxcvt,
				f.$ix, // push two words
				"WCVTP" // write cvt entry
			);
		}
	}
	return ctx;
}

async function buildOTD(ctx, tdir, prefix) {
	let otdPaths = [];
	for (let fid in ctx.items) {
		const pOTD = prefix
			? prefix + "." + otdPaths.length + ".otd"
			: temp.path({ dir: tdir, suffix: ".otd" });
		await ctx.run(build, fid, { to: pOTD });
		ctx.remove(fid);
		if (global.gc) global.gc();
		otdPaths.push(pOTD);
	}

	return otdPaths;
}

// Pass 2 : build TTC files
async function buildTTC(otdPaths, tdir) {
	// build OTF
	let paths = [];
	for (let pOTD of otdPaths) {
		const pOTF = temp.path({ dir: tdir, suffix: ".otf" });
		await spawn(
			which.sync("otfccbuild"),
			[pOTD, "-o", pOTF, "-k", "--subroutinize", "--keep-average-char-width"],
			{
				stdio: "inherit"
			}
		);
		await fs.remove(pOTD);
		paths.push(pOTF);
	}

	// build TTC
	await mergeTables(paths, argv.o);
	await Promise.all(paths.map(p => fs.remove(p)));
}

async function main() {
	if (!argv.prefix && !argv.o) throw new Error("Must specify an output.");
	if (!argv._.length) throw new Error("Must have at least one input.");

	const tdir = path.dirname(path.resolve(argv.prefix || argv.o));
	await fs.ensureDir(tdir);

	const otds = await buildOTD(await collectGlyphs(new Workflow({})), tdir, argv.prefix);

	if (argv.o) {
		if (global.gc) global.gc();
		await buildTTC(otds, tdir);
	}
}

main().catch(e => console.error(e));

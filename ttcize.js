const fs = require("fs");
const temp = require("temp");
const child_process = require("child_process");
const stringifyToStream = require("./stringify-to-stream");

const argv = require("yargs").describe("h", "merge hints").boolean("h").boolean("k").argv;

class GMAPEntry {
	constructor(fwid, ix, n) {
		this.fwid = fwid;
		this.firstInstID = ix;
		this.firstInstGID = n;
		this.used = [ix];
	}
	compareTo(that) {
		if (this.fwid === that.fwid) {
			return this.firstInstID === that.firstInstID
				? this.firstInstGID - that.firstInstGID
				: this.firstInstID - that.firstInstID;
		} else {
			return this.fwid - that.fwid;
		}
	}
}

temp.track();

void (function() {
	let fonts = [];
	let glyf = {};
	let gmap = {};
	let ix = 0;
	let maxcvt = 0;
	for (let f of argv._) {
		let p = temp.path();
		let prefix = `s.`;
		//let prefix = `s${fonts.length}.`;
		console.log(`Reading font ${f}`);
		child_process.execSync(
			`otfccdump ${f} -o ${p} --name-by-hash --glyph-name-prefix=${prefix}`
		);
		let font = JSON.parse(fs.readFileSync(p, "utf-8"));
		fs.unlinkSync(p);
		let n = 0;
		for (let gid in font.glyf) {
			if (!glyf[gid]) {
				glyf[gid] = font.glyf[gid];
				const fwid = n > 1 && glyf[gid].advanceWidth === font.head.unitsPerEm ? 1 : 0;
				gmap[gid] = new GMAPEntry(fwid, ix, n);
			} else {
				font.glyf[gid] = glyf[gid];
				gmap[gid].used.push(ix);
			}
			n += 1;
		}
		font.glyf = glyf;
		fonts.push(font);
		if (global.gc) {
			global.gc();
		}
		if (argv.h && font.cvt_) {
			maxcvt = Math.max(font.cvt_.length, maxcvt);
		}
		font.$ix = ix;
		ix += 1;
	}
	let keys = Object.keys(gmap).sort((a, b) => gmap[a].compareTo(gmap[b]));
	process.stderr.write(`${keys.length} unique glyphs after merging.` + "\n");
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
	for (let f of fonts) {
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

	writeOTDs(fonts, finalize)();
})();

function writeOTDs(fonts, callback) {
	let current = 0;
	const total = fonts.length;
	let otds = [];
	let ttfs = [];
	function step() {
		if (current >= total) return callback({ otds, ttfs });
		console.log(`Building temp font ${current}`);
		let pOTD = temp.path();
		let pTTF = temp.path();
		let outstream = fs.createWriteStream(pOTD, { encoding: "utf-8" });
		stringifyToStream(fonts[current], outstream, false)(function() {
			current += 1;
			otds.push(pOTD);
			ttfs.push(pTTF);
			if (global.gc) {
				global.gc();
			}
			setTimeout(step, 0);
		});
	}
	return step;
}

function finalize(input) {
	const { otds, ttfs } = input;
	if (global.gc) {
		global.gc();
	}

	for (let j = 0; j < otds.length; j++) {
		let pOTD = otds[j],
			pTTF = ttfs[j];
		child_process.execSync(`otfccbuild ${pOTD} -o ${pTTF} -O3 -k --keep-average-char-width`);
		console.log(`Temp font ${j} successfully built.`);
		fs.unlinkSync(pOTD);
	}

	child_process.execSync(`otf2otc ${ttfs.join(" ")} -o ${argv.o}`);
	for (let p of ttfs) {
		fs.unlinkSync(p);
	}
}

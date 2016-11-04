const fs = require("fs");
const argv = require("yargs").argv;
const temp = require("temp");
const child_process = require("child_process");

temp.track();

let otds = [];
let ttfs = [];

void function () {
	let fonts = [];
	let glyf = {};

	for (let f of argv._) {
		let p = temp.path();
		let prefix = `s${fonts.length}.`;
		child_process.execSync(`otfccdump ${f} -o ${p} --name-by-hash --glyph-name-prefix=${prefix}`);
		let font = JSON.parse(fs.readFileSync(p));
		fs.unlinkSync(p);
		for (let gid in font.glyf) {
			if (!glyf[gid]) {
				glyf[gid] = font.glyf[gid];
			} else {
				font.glyf[gid] = glyf[gid];
			}
		}
		font.glyf = glyf;
		fonts.push(font);
		if (global.gc) {
			global.gc();
		}
	}

	let keys = Object.keys(glyf);
	process.stderr.write(`${keys.length} unique glyphs after merging.` + "\n");


	for (let font of fonts) {
		let pOTD = temp.path();
		let pTTF = temp.path();
		font.glyph_order = keys;
		fs.writeFileSync(pOTD, JSON.stringify(font));
		otds.push(pOTD);
		ttfs.push(pTTF);
		if (global.gc) { global.gc(); }
	}
}();

if (global.gc) { global.gc(); }

for (let j = 0; j < otds.length; j++) {
	let pOTD = otds[j], pTTF = ttfs[j];
	child_process.execSync(`otfccbuild ${pOTD} -o ${pTTF} -O3 -k --keep-average-char-width`);
	fs.unlinkSync(pOTD);
}

child_process.execSync(`otf2otc ${ttfs.join(' ')} -o ${argv.o}`);
for (let p of ttfs) {
	fs.unlinkSync(p);
}

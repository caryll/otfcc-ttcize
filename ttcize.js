const fs = require("fs");
const argv = require("yargs").argv;
const temp = require("temp");
const child_process = require("child_process");

temp.track();

let fonts = [];
for (let f of argv._) {
	let p = temp.path();
	let prefix = `s${fonts.length}.`;
	child_process.execSync(`otfccdump ${f} -o ${p} --name-by-hash --glyph-name-prefix=${prefix}`);
	let font = JSON.parse(fs.readFileSync(p));
	fonts.push(font);
}

let glyf = {};
for (let font of fonts) {
	for (let gid in font.glyf) {
		if (!glyf[gid]) {
			glyf[gid] = font.glyf[gid];
		}
	}
}
let keys = Object.keys(glyf);
process.stderr.write(`${keys.length} unique glyphs after merging.`);

let ttfs = [];
for (let font of fonts) {
	let pOTD = temp.path();
	let pTTF = temp.path();
	font.glyf = glyf;
	font.glyph_order = keys;
	fs.writeFileSync(pOTD, JSON.stringify(font));
	child_process.execSync(`otfccbuild ${pOTD} -o ${pTTF} -O3 -k --keep-average-char-width`);
	ttfs.push(pTTF);
}

child_process.execSync(`otf2otc ${ttfs.join(' ')} -o ${argv.o}`);

const fs = require("fs");
const argv = require("yargs").argv;
const temp = require("temp");
const child_process = require("child_process");
const stringifyToStream = require("./stringify-to-stream");

temp.track();

void function () {
	let fonts = [];
	let glyf = {};
	let gmap = {};
	let ix = 0;
	for (let f of argv._) {
		let p = temp.path();
		let prefix = `s${fonts.length}.`;
		console.log(`Reading font ${f}`);
		child_process.execSync(`otfccdump ${f} -o ${p} --name-by-hash --glyph-name-prefix=${prefix}`);
		let font = JSON.parse(fs.readFileSync(p));
		fs.unlinkSync(p);
		let n = 0;
		for (let gid in font.glyf) {
			if (!glyf[gid]) {
				glyf[gid] = font.glyf[gid];
				gmap[gid] = [ix, n]
			} else {
				font.glyf[gid] = glyf[gid];
			}
			n += 1;
		}
		font.glyf = glyf;
		fonts.push(font);
		if (global.gc) { global.gc() }
		ix += 1;
	}

	let keys = Object.keys(gmap).sort(function(a, b){
		const p = gmap[a], q = gmap[b];
		return p[0] === q[0] ? p[1] - q[1] : p[0] - q[0];
	});
	process.stderr.write(`${keys.length} unique glyphs after merging.` + "\n");

	for (let f of fonts) { f.glyph_order = keys }

	writeOTDs(fonts, finalize)();
}();

function writeOTDs(fonts, callback) {
	let current = 0;
	const total = fonts.length;
	let otds = [];
	let ttfs = [];
	function step(){
		if(current >= total) return callback({otds, ttfs});
		console.log(`Building temp font ${current}`);
		let pOTD = temp.path();
		let pTTF = temp.path();
		let outstream = fs.createWriteStream(pOTD, { encoding: "utf-8" });
		stringifyToStream(fonts[current], outstream, false)(function(){
			console.log(`Temp font ${current} successfully built.`);
			current += 1;
			otds.push(pOTD);
			ttfs.push(pTTF);
			if (global.gc) { global.gc(); }
			setTimeout(step, 0);
		})
	}
	return step;
}

function finalize(input){
	const {otds,ttfs} = input;
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
}

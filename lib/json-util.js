const stripBomStream = require("strip-bom-stream");
const JSONStream = require("JSONStream");

exports.parseJsonObjectFromStream = function(input) {
	return new Promise(function(resolve, reject) {
		let font = {};
		input
			.pipe(stripBomStream())
			.pipe(JSONStream.parse("$*"))
			.on("data", data => {
				font[data.key] = data.value;
			})
			.on("close", () => resolve(font))
			.on("error", e => reject(e));
	});
};

const BUFFER_LIMIT = 1e6;
const NEST = 3;

const JsonStringify = Symbol();
exports.JsonStringify = JsonStringify;

class BufferedWriter {
	constructor(writer) {
		this.writer = writer;
		this.buffer = "";
	}

	push(str) {
		this.buffer += str;
		if (this.buffer.length > BUFFER_LIMIT) this.flush();
	}
	flush() {
		if (!this.buffer) return;
		this.writer.write(this.buffer, "utf8");
		this.buffer = "";
	}
}

function waitStreamEnd(stream) {
	return new Promise((resolve, reject) => {
		stream.end();
		stream.on("close", () => resolve());
		stream.on("error", why => reject(why));
	});
}

exports.fontJsonStringifyToStream = async function(font, output) {
	const writer = new BufferedWriter(output);
	writer.push("{");
	for (const key in font) {
		if (key === "glyf") continue;
		writer.push(JSON.stringify(key) + ":" + JSON.stringify(font[key]));
		writer.push(",");
	}
	if (font.glyf) {
		// Serialize glyphs
		writer.push('"glyf":{');
		let started = false;
		for (const gid in font.glyf) {
			if (started) writer.push(",");
			writer.push(JSON.stringify(gid) + ":" + font.glyf[gid][JsonStringify]() + "\n");
			started = true;
		}
		writer.push("}");
	} else {
		writer.push('"glyf":null');
	}
	writer.push("}");
	writer.flush();
	await waitStreamEnd(output);
};

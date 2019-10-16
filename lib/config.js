const which = require("which");

module.exports = function(argv) {
	return {
		doHintWrapping: !!(argv.h && !argv.x),
		gapMode: !!argv.x,
		commonWidth: argv["common-width"] - 0 || -1,
		commonHeight: argv["common-height"] - 0 || -1,
		dumpCommand: argv["otfccdump-command"] || which.sync("otfccdump"),
		buildCommand: argv["otfccbuild-command"] || which.sync("otfccbuild")
	};
};

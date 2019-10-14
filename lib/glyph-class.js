exports.NotDef = 0;
exports.Space = 1;
exports.PostSpacePad = 2;
exports.Normal = 3;
exports.Combining = 4;
exports.CommonWidth = 5;

exports.decideGlyphClass = function(glyph, gid, commonWidth) {
	if (gid === 0) return exports.NotDef;
	if (
		(!glyph.contours || glyph.contours.length === 0) &&
		(!glyph.references || glyph.references.length === 0)
	) {
		return exports.Space;
	}
	if (glyph.advanceWidth === 0) {
		return exports.Combining;
	}
	if (glyph.advanceWidth === commonWidth && glyph.advanceHeight === commonWidth) {
		return exports.CommonWidth;
	}

	return exports.Normal;
};

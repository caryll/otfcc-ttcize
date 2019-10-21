# `otfcc-ttcize`

TrueType TTC bundler with glyph sharing.

**NOTE:** Glyph sharing do not work for CFF. Please consider use `otf2otc` instead.

## Usage

```bash
otfcc-ttcize [options] -o <output> <input.ttf> <input2.ttf> ...
```

## Options

- `-x`: Use the “gap mode” to support more than 65,535 glyph data in one TTC. Note that it *may* cause compatibility issues in legacy software.
- `-h`: Wrap hint instructions. It would be disabled under “gap mode”.
- `--common-width=<length>`, `--common-height=<length>`: Set the most common glyph width and height. It will reduce the size of `hmtx` and `vmtx` tables.
- `--otfccdump-command=<path>`, `--otfccbuild-command=<path>`: Set the path of `otfcc` executables.
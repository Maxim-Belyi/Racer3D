const fs = require('fs');

// We'll write a small node script that uses the built-in 'zlib' and basic buffer parsing
// to decompress PNG IDAT chunks and check if there's an alpha value < 255 and > 0.
// Actually, easier: let's install `jimp` or `pngjs` locally in a temp dir to do this.

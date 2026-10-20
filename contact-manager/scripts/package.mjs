// Builds contact-manager.zip from dist/index.js + manifest.json, the layout
// the webmail's plugin installer expects: both files at the root of the ZIP.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// Fixed timestamp so the ZIP is byte-for-byte reproducible: the release script
// compares the freshly built artifact with the committed one.
const BUILD_DATE = new Date('1980-01-01T00:00:00Z');

const zip = new JSZip();
zip.file('manifest.json', await readFile(path.join(ROOT, 'manifest.json')), { date: BUILD_DATE });
zip.file('index.js', await readFile(path.join(ROOT, 'dist', 'index.js')), { date: BUILD_DATE });

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const out = path.join(ROOT, 'contact-manager.zip');
await writeFile(out, buffer);

const check = await JSZip.loadAsync(buffer);
console.log(`wrote ${path.relative(process.cwd(), out)} (${buffer.length} bytes), entries: ${Object.keys(check.files).join(', ')}`);

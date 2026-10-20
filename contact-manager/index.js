// Development entry point.
//
// The plugin's real source entry is `src/index.js`; `npm run build` bundles it
// with esbuild to `dist/index.js`, and `npm run package` puts that bundle into
// `contact-manager.zip`.
//
// This root file exists so that the folder can be used directly as a
// `PLUGIN_DEV_DIR` plugin folder: the host loads `manifest.json` and then
// `index.js` from the plugin root. It simply re-exports the built bundle.
//
// Run `npm run build` before starting the webmail with this folder mounted —
// the bundle itself is not committed.
try {
  module.exports = require('./dist/index.js');
} catch (err) {
  throw new Error(
    'contact-manager: dist/index.js is missing or broken — run `npm run build` first. ' +
      `(${err && err.message})`,
  );
}




// Hands bytes to the browser as a download. The plugin never stores the file:
// it only passes through. Guarded so an environment without Blob URLs (the
// unit-test jsdom, for one) simply does nothing instead of throwing.
export function downloadBlob(data, name) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking the object URL on the same turn can cancel the download before the
  // browser has read the blob — it is released on the next turn instead. This
  // is why an export could report success and produce no file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Saves bytes, preferring the host's own download.
 *
 * The plugin frame is sandboxed without `allow-downloads`, so an anchor click is
 * refused outright (the console says so). `api.ui.downloadFile` is the host's
 * own mechanism and is not subject to that flag.
 *
 * @returns {Promise<boolean>} whether the host took the file. When it did not,
 *   the caller shows the content instead of claiming a download happened.
 */
export async function saveFile(api, data, name, type = 'application/octet-stream') {
  const download = api?.ui?.downloadFile;
  if (typeof download === 'function') {
    try {
      await download(name, data, type);
      return true;
    } catch {
      // the host refused, or its argument order is not the one guessed here
    }
  }
  downloadBlob(data instanceof Blob ? data : new Blob([data], { type }), name);
  return false;
}

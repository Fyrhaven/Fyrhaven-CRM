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

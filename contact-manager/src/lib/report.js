// Reporting a failure the user needs to see.
//
// A toast is right for "that did not work, carry on". Some failures are not:
// a scan that could not read the address books, an undo that could not restore,
// a download that was refused. For those the host's own alert is used, because
// it stops and is read — with a toast as the fallback when the host has none.
//
// `api.ui.alert` is called the way `api.ui.confirm` is, with an object, because
// the two sit next to each other in the surface and share a shape.

export async function reportError(api, message, { title } = {}) {
  const alert = api?.ui?.alert;
  if (typeof alert === 'function') {
    try {
      await alert({ title: title ?? api.i18n.t('error.title'), message });
      return;
    } catch {
      // the host has no usable alert, or its shape differs: fall through
    }
  }
  api.toast.error(message);
}

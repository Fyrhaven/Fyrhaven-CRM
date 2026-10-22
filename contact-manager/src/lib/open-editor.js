// Opening the contact editor from anywhere: the palette, the Contact
// Manager page and the contact-details section all funnel through here, so
// the dialog props and the result toast stay in one place.

export async function openEditor(api, { mode = 'create', contact = null, company = false } = {}) {
  const titleKey = company
    ? (mode === 'edit' ? 'editor.titleCompanyEdit' : 'editor.titleCompany')
    : (mode === 'edit' ? 'editor.titleEdit' : 'editor.title');
  return api.ui.openDialog({
    title: api.i18n.t(titleKey),
    slot: 'plugin-dialog',
    extraProps: { editor: true, mode, contact, company },
  });
}

/** The toast for whatever the editor returned (null when it was cancelled). */
export function toastEditorResult(api, result) {
  if (!result) return;
  if (result.deleted) api.toast.success(api.i18n.t('editor.deleted'));
  else api.toast.success(api.i18n.t(result.saved === 'created' ? 'editor.created' : 'editor.updated'));
}

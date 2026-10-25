// Which column of a CSV goes into which field of a contact.
//
// Pure: no api, no DOM. `import.js` turns the mapped rows into drafts, and
// `import-templates.js` remembers a mapping the user has settled on.

/**
 * Every field a column can be mapped to. `ignore` drops the column.
 *
 * There is no `url`: the card builder does not write `onlineServices` yet, and a
 * field the import cannot store is worse than one it admits it cannot.
 */
export const IMPORT_FIELDS = [
  'ignore', 'given', 'surname', 'name', 'nickname', 'email', 'phone',
  'organization', 'title', 'notes', 'tags',
  'address', 'street', 'locality', 'region', 'postcode', 'country',
];

/** The address fields, which share one draft object. */
export const ADDRESS_FIELDS = ['street', 'locality', 'region', 'postcode', 'country'];

/**
 * The header spellings seen in the wild, per field. Matching is
 * case-insensitive and ignores punctuation, so `E-mail 1 - Value` and
 * `email_1_value` both land on `email`.
 *
 * Google and Apple exports are the two that matter most: Google writes
 * `Given Name`, `E-mail 1 - Value`, `Phone 1 - Value`, `Organization 1 - Name`
 * and the structured `Address 1 - City` … columns; Apple writes `First Name`,
 * `Last Name`, `E-mail Address`, `Home Phone`.
 */
export const HEADER_HINTS = {
  given: ['givenname', 'firstname', 'first', 'vorname', 'given'],
  surname: ['surname', 'lastname', 'familyname', 'last', 'nachname', 'family'],
  name: ['fullname', 'displayname', 'formattedname', 'name'],
  nickname: ['nickname', 'nicknames', 'alias', 'rufname'],
  email: ['email', 'emailaddress', 'mail', 'email1value', 'email2value', 'emails'],
  phone: ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'phone1value', 'phone2value', 'cell'],
  organization: ['organization', 'organisation', 'company', 'org', 'firma', 'organization1name'],
  title: ['organization1title', 'organizationtitle', 'jobtitle', 'position1value', 'position', 'title', 'role', 'funktion'],
  notes: ['notes', 'note', 'comment', 'comments', 'bemerkung'],
  tags: ['groupmembership', 'categories', 'kategorien', 'labels', 'groups', 'tags', 'tag'],
  // a whole address in one column; the structured columns win when both exist
  address: ['address1formatted', 'formattedaddress', 'fulladdress'],
  street: ['address1street', 'street', 'streetaddress', 'strasse'],
  locality: ['address1city', 'city', 'locality', 'town', 'ort', 'stadt'],
  region: ['address1region', 'state', 'province', 'region', 'bundesland'],
  postcode: ['address1postalcode', 'postalcode', 'postcode', 'zip', 'plz'],
  country: ['address1country', 'country', 'land'],
};

/** Lower-case, and strip everything that is not a letter or a digit. */
const key = (header) => String(header ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The best guess for one header: the first field whose hints match, longest
 * hint first so `lastname` beats `last`.
 */
export function guessField(header) {
  const wanted = key(header);
  if (!wanted) return 'ignore';
  const candidates = [];
  for (const [field, hints] of Object.entries(HEADER_HINTS)) {
    for (const hint of hints) {
      const clean = key(hint);
      if (clean && wanted.includes(clean)) candidates.push({ field, length: clean.length });
    }
  }
  if (!candidates.length) return 'ignore';
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0].field;
}

/** A mapping for a whole header row. */
export const guessMapping = (headers) => (Array.isArray(headers) ? headers : []).map(guessField);

/** The mapping as a stable string, for remembering one per header set. */
export const mappingKey = (headers) => (Array.isArray(headers) ? headers : []).map(key).join('|');

/** True when a mapping actually uses a column. */
export const isUsableMapping = (mapping) => (Array.isArray(mapping) ? mapping : [])
  .some((field) => field && field !== 'ignore');

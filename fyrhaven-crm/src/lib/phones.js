// Phone numbers as E.164, for matching and for normalising a selection.
//
// Pure: no api, no DOM. E.164 needs to know *where* a national number is from,
// so a region has to be given; without one only the international forms (`+…`
// and `00…`) can be normalised. The plugin deliberately refuses to guess a
// country, because guessing wrong writes a wrong number onto a contact.

/** A working set of dial codes. Extend as needed; the code is the ISO 3166-1 alpha-2. */
export const REGIONS = [
  { code: 'DE', dial: '49', name: 'Germany' },
  { code: 'AT', dial: '43', name: 'Austria' },
  { code: 'CH', dial: '41', name: 'Switzerland' },
  { code: 'FR', dial: '33', name: 'France' },
  { code: 'GB', dial: '44', name: 'United Kingdom' },
  { code: 'IE', dial: '353', name: 'Ireland' },
  { code: 'IT', dial: '39', name: 'Italy' },
  { code: 'ES', dial: '34', name: 'Spain' },
  { code: 'PT', dial: '351', name: 'Portugal' },
  { code: 'NL', dial: '31', name: 'Netherlands' },
  { code: 'BE', dial: '32', name: 'Belgium' },
  { code: 'LU', dial: '352', name: 'Luxembourg' },
  { code: 'DK', dial: '45', name: 'Denmark' },
  { code: 'SE', dial: '46', name: 'Sweden' },
  { code: 'NO', dial: '47', name: 'Norway' },
  { code: 'FI', dial: '358', name: 'Finland' },
  { code: 'PL', dial: '48', name: 'Poland' },
  { code: 'CZ', dial: '420', name: 'Czechia' },
  { code: 'SK', dial: '421', name: 'Slovakia' },
  { code: 'HU', dial: '36', name: 'Hungary' },
  { code: 'RO', dial: '40', name: 'Romania' },
  { code: 'BG', dial: '359', name: 'Bulgaria' },
  { code: 'GR', dial: '30', name: 'Greece' },
  { code: 'TR', dial: '90', name: 'Türkiye' },
  { code: 'UA', dial: '380', name: 'Ukraine' },
  { code: 'US', dial: '1', name: 'United States' },
  { code: 'CA', dial: '1', name: 'Canada' },
  { code: 'MX', dial: '52', name: 'Mexico' },
  { code: 'BR', dial: '55', name: 'Brazil' },
  { code: 'AR', dial: '54', name: 'Argentina' },
  { code: 'AU', dial: '61', name: 'Australia' },
  { code: 'NZ', dial: '64', name: 'New Zealand' },
  { code: 'JP', dial: '81', name: 'Japan' },
  { code: 'CN', dial: '86', name: 'China' },
  { code: 'IN', dial: '91', name: 'India' },
  { code: 'SG', dial: '65', name: 'Singapore' },
  { code: 'ZA', dial: '27', name: 'South Africa' },
  { code: 'AE', dial: '971', name: 'United Arab Emirates' },
  { code: 'IL', dial: '972', name: 'Israel' },
];

/** The dial code of a region, or '' when the region is unknown or unset. */
export function dialCode(region) {
  const wanted = String(region ?? '').trim().toUpperCase();
  if (!wanted) return '';
  return REGIONS.find((entry) => entry.code === wanted)?.dial ?? '';
}

/**
 * Is this the canonical E.164 form: a leading `+`, 7 to 15 digits, and no
 * leading zero. A bare digit string is **not** E.164 — it is just digits.
 */
export function isValidE164(value) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('+')) return false;
  const digits = raw.slice(1);
  return /^\d{7,15}$/.test(digits) && !digits.startsWith('0');
}

/**
 * One number as E.164, or `''` when it cannot be done confidently.
 *
 * - `+49 176 1234567` and `0049 176 1234567` → `+491761234567`
 * - `0176 1234567` with region `DE` → `+491761234567`
 * - a national number with **no** region → `''` (the country is unknown)
 * - a national number that already begins with the region's dial code → `''`,
 *   because it is ambiguous: German `0491…` (Leer) and `+49 491…` both exist,
 *   and guessing would write a wrong number onto a contact.
 */
export function toE164(number, region = '') {
  const raw = String(number ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) return isValidE164(`+${digits}`) ? `+${digits}` : '';
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    return isValidE164(`+${rest}`) ? `+${rest}` : '';
  }

  const dial = dialCode(region);
  if (!dial) return '';
  const national = digits.replace(/^0+/, '');
  if (!national || national.startsWith(dial)) return '';
  const full = `${dial}${national}`;
  return isValidE164(`+${full}`) ? `+${full}` : '';
}

/**
 * The comparison key for a number: its E.164 when that is possible, otherwise
 * digits with the leading `00` and zeros dropped. Under 7 digits is no number
 * at all (an extension, a year).
 */
export function phoneKey(number, region = '') {
  const e164 = toE164(number, region);
  if (e164) return e164.replace('+', '');
  const digits = String(number ?? '').replace(/\D/g, '').replace(/^00/, '').replace(/^0+/, '');
  return digits.length >= 7 ? digits : '';
}

/** `+49 176 1234567` — grouped for display only. */
export function formatE164(value) {
  const e164 = String(value ?? '').trim();
  if (!isValidE164(e164)) return String(value ?? '');
  const digits = e164.replace('+', '');
  const region = REGIONS.find((entry) => digits.startsWith(entry.dial));
  const rest = region ? digits.slice(region.dial.length) : digits;
  const groups = rest.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  return `+${region ? region.dial : ''} ${groups}`.trim();
}

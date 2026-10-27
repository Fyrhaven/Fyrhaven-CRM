// The policies dialog: per-address-book duplicate detection settings and
// global ignore rules. Opened from the Duplicates page; saves to api.storage
// through lib/book-policies.js.

import {
  Button, Checkbox, DialogButtons, Input, Row, Section, Segmented, Stack, Text,
} from '@plugin-host/ui';
import {
  readPolicies, readIgnore, writePolicies, writeIgnore, PROTECTED_FIELDS,
} from './book-policies.js';
import { reportError } from './report.js';

// The three match strategies a book can override, and the label each carries.
const STRATEGIES = [
  ['matchByEmail', 'policies.matchByEmail'],
  ['matchByPhone', 'policies.matchByPhone'],
  ['matchByName', 'policies.matchByName'],
];

export function makePoliciesDialog(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function PoliciesDialog(props) {
    const books = Array.isArray(props.books) ? props.books : [];
    const [policies, setPolicies] = useState({});
    const [ignore, setIgnore] = useState({ domains: [], tags: [], companies: [] });
    const [domainDraft, setDomainDraft] = useState('');
    const [tagDraft, setTagDraft] = useState('');
    const [companyDraft, setCompanyDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      Promise.all([readPolicies(api), readIgnore(api)])
        .then(([p, i]) => { setPolicies(p); setIgnore(i); setLoading(false); })
        .catch(async (err) => {
          // Say so. A dialog showing empty policies that the user then saves
          // would overwrite the real ones.
          setLoading(false);
          await reportError(api, t('policies.loadFailed', { reason: String(err?.message ?? err) }));
        });
    }, []);

    const close = (value) => props.onResult?.(value);
    const policyFor = (bookId) => policies[bookId] ?? {};

    const setBookField = (bookId, field, value) => {
      const current = policies[bookId] ?? {};
      const next = { ...current, [field]: value };
      if (next[field] === undefined || next[field] === null) delete next[field];
      const updated = { ...policies };
      if (!Object.keys(next).length) delete updated[bookId];
      else updated[bookId] = next;
      setPolicies(updated);
    };

    const toggleBook = (bookId, field) => {
      // Flip what is SHOWN. The box reads `!== false`, so an untouched field
      // looks on — `!current[field]` read that `undefined` as off and made the
      // first click do nothing at all.
      setBookField(bookId, field, policyFor(bookId)[field] === false);
    };

    // A strategy is tri-state: `undefined` follows the global setting, `true`
    // forces it on for this book, `false` forces it off. Without the third
    // position an override could never be taken back.
    const strategyValue = (bookId, field) => {
      const value = policyFor(bookId)[field];
      if (value === undefined) return 'default';
      return value ? 'on' : 'off';
    };

    const setStrategy = (bookId, field, value) => {
      setBookField(bookId, field, value === 'default' ? undefined : value === 'on');
    };

    // Protected fields are a plain list on the policy: add or remove one, and
    // drop the key entirely when the last one goes.
    const toggleProtected = (bookId, field) => {
      const current = policyFor(bookId).protectedFields ?? [];
      const next = current.includes(field)
        ? current.filter((name) => name !== field)
        : [...current, field];
      setBookField(bookId, 'protectedFields', next.length ? next : undefined);
    };

    const strategyOptions = () => [
      { value: 'default', label: t('policies.default') },
      { value: 'on', label: t('policies.on') },
      { value: 'off', label: t('policies.off') },
    ];

    const addDomain = () => {
      const domain = domainDraft.trim().toLowerCase();
      if (!domain || ignore.domains.includes(domain)) { setDomainDraft(''); return; }
      setIgnore({ ...ignore, domains: [...ignore.domains, domain] });
      setDomainDraft('');
    };

    const removeDomain = (domain) => {
      setIgnore({ ...ignore, domains: ignore.domains.filter((d) => d !== domain) });
    };

    const addTag = () => {
      const tag = tagDraft.trim();
      if (!tag || ignore.tags.includes(tag)) { setTagDraft(''); return; }
      setIgnore({ ...ignore, tags: [...ignore.tags, tag] });
      setTagDraft('');
    };

    const removeTag = (tag) => {
      setIgnore({ ...ignore, tags: ignore.tags.filter((t) => t !== tag) });
    };

    const addCompany = () => {
      const company = companyDraft.trim();
      if (!company || ignore.companies.includes(company)) { setCompanyDraft(''); return; }
      setIgnore({ ...ignore, companies: [...ignore.companies, company] });
      setCompanyDraft('');
    };

    const removeCompany = (company) => {
      setIgnore({ ...ignore, companies: ignore.companies.filter((c) => c !== company) });
    };

    const save = async () => {
      setSaving(true);
      try {
        await Promise.all([writePolicies(api, policies), writeIgnore(api, ignore)]);
        close({ saved: true });
      } catch (err) {
        // A save that did not happen must not look like one that did.
        setSaving(false);
        await reportError(api, t('policies.saveFailed', { reason: String(err?.message ?? err) }));
      }
    };

    if (loading) return h(Stack, { gap: 3 }, h(Text, null, '…'));

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('policies.intro')),

      books.length ? h(Section, { title: t('policies.booksSection') },
        h(Stack, { gap: 3 },
          ...books.map((book) => h(Stack, { key: book.id, gap: 2 },
            h(Text, { weight: 'semibold' }, book.name || book.id),
            h(Checkbox, {
              checked: policyFor(book.id).enabled !== false,
              onChange: () => toggleBook(book.id, 'enabled'),
              label: t('policies.enabled'),
            }),
            h(Row, { gap: 3, wrap: true },
              ...STRATEGIES.map(([field, labelKey]) => h(Segmented, {
                key: field,
                label: t(labelKey),
                value: strategyValue(book.id, field),
                options: strategyOptions(),
                onChange: (value) => setStrategy(book.id, field, value),
              })),
            ),
            h(Text, { weight: 'semibold' }, t('policies.protected')),
            h(Text, { tone: 'muted' }, t('policies.protectedHint')),
            h(Row, { gap: 3, wrap: true },
              ...PROTECTED_FIELDS.map((field) => h(Checkbox, {
                key: field,
                checked: (policyFor(book.id).protectedFields ?? []).includes(field),
                onChange: () => toggleProtected(book.id, field),
                label: t(`policies.field.${field}`),
              })),
            ),
          )),
        ),
      ) : h(Text, { tone: 'muted' }, t('policies.noBooks')),

      h(Section, { title: t('policies.ignoreSection') },
        h(Stack, { gap: 3 },
          h(Stack, { gap: 2 },
            h(Text, { weight: 'semibold' }, t('policies.ignoredDomains')),
            h(Text, { tone: 'muted' }, t('policies.ignoredDomainsHint')),
            ignore.domains.length
              ? h(Row, { gap: 2, wrap: true },
                  ...ignore.domains.map((domain) => h(Button, {
                    key: domain, size: 'small', variant: 'ghost',
                    onClick: () => removeDomain(domain),
                  }, `${domain} \u00d7`)))
              : null,
            h(Row, { gap: 2 },
              h(Input, {
                value: domainDraft,
                onChange: (event) => setDomainDraft(event.target.value),
                placeholder: t('policies.domainPlaceholder'),
                onKeyDown: (event) => { if (event.key === 'Enter') addDomain(); },
              }),
              h(Button, { onClick: addDomain, variant: 'secondary' }, t('policies.addDomain')),
            ),
          ),
          h(Stack, { gap: 2 },
            h(Text, { weight: 'semibold' }, t('policies.ignoredTags')),
            h(Text, { tone: 'muted' }, t('policies.ignoredTagsHint')),
            ignore.tags.length
              ? h(Row, { gap: 2, wrap: true },
                  ...ignore.tags.map((tag) => h(Button, {
                    key: tag, size: 'small', variant: 'ghost',
                    onClick: () => removeTag(tag),
                  }, `${tag} \u00d7`)))
              : null,
            h(Row, { gap: 2 },
              h(Input, {
                value: tagDraft,
                onChange: (event) => setTagDraft(event.target.value),
                placeholder: t('policies.tagPlaceholder'),
                onKeyDown: (event) => { if (event.key === 'Enter') addTag(); },
              }),
              h(Button, { onClick: addTag, variant: 'secondary' }, t('policies.addTag')),
            ),
          ),
          h(Stack, { gap: 2 },
            h(Text, { weight: 'semibold' }, t('policies.ignoredCompanies')),
            h(Text, { tone: 'muted' }, t('policies.ignoredCompaniesHint')),
            ignore.companies.length
              ? h(Row, { gap: 2, wrap: true },
                  ...ignore.companies.map((company) => h(Button, {
                    key: company, size: 'small', variant: 'ghost',
                    onClick: () => removeCompany(company),
                  }, `${company} \u00d7`)))
              : null,
            h(Row, { gap: 2 },
              h(Input, {
                value: companyDraft,
                onChange: (event) => setCompanyDraft(event.target.value),
                placeholder: t('policies.companyPlaceholder'),
                onKeyDown: (event) => { if (event.key === 'Enter') addCompany(); },
              }),
              h(Button, { onClick: addCompany, variant: 'secondary' }, t('policies.addCompany')),
            ),
          ),
        ),
      ),

      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'save', label: t('policies.save'), variant: 'primary', disabled: saving },
        ],
        onClick: (id) => { if (id === 'save') save(); else close(null); },
      }),
    );
  };
}

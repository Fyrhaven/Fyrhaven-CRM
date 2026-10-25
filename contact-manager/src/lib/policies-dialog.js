// The policies dialog: per-address-book duplicate detection settings and
// global ignore rules. Opened from the Duplicates page; saves to api.storage
// through lib/book-policies.js.

import {
  Button, Checkbox, DialogButtons, Field, Input, Row, Section, Stack, Text,
} from '@plugin-host/ui';
import { readPolicies, readIgnore, writePolicies, writeIgnore } from './book-policies.js';

export function makePoliciesDialog(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function PoliciesDialog(props) {
    const books = Array.isArray(props.books) ? props.books : [];
    const [policies, setPolicies] = useState({});
    const [ignore, setIgnore] = useState({ domains: [], tags: [] });
    const [domainDraft, setDomainDraft] = useState('');
    const [tagDraft, setTagDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      Promise.all([readPolicies(api), readIgnore(api)])
        .then(([p, i]) => { setPolicies(p); setIgnore(i); setLoading(false); })
        .catch(() => setLoading(false));
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
      const current = policyFor(bookId);
      setBookField(bookId, field, !current[field]);
    };

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

    const save = async () => {
      setSaving(true);
      try {
        await Promise.all([writePolicies(api, policies), writeIgnore(api, ignore)]);
        close({ saved: true });
      } catch {
        setSaving(false);
      }
    };

    if (loading) return h(Stack, { gap: 3 }, h(Text, null, '…'));

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('policies.intro')),

      books.length ? h(Section, { title: t('policies.booksSection') },
        h(Stack, { gap: 3 },
          ...books.map((book) => h(Stack, { key: book.id, gap: 2 },
            h(Text, { weight: 'semibold' }, book.name || book.id),
            h(Row, { gap: 3, wrap: true },
              h(Checkbox, {
                checked: policyFor(book.id).enabled !== false,
                onChange: () => toggleBook(book.id, 'enabled'),
                label: t('policies.enabled'),
              }),
              h(Checkbox, {
                checked: policyFor(book.id).matchByEmail !== false,
                onChange: () => toggleBook(book.id, 'matchByEmail'),
                label: t('policies.matchByEmail'),
              }),
              h(Checkbox, {
                checked: policyFor(book.id).matchByPhone !== false,
                onChange: () => toggleBook(book.id, 'matchByPhone'),
                label: t('policies.matchByPhone'),
              }),
              h(Checkbox, {
                checked: policyFor(book.id).matchByName !== false,
                onChange: () => toggleBook(book.id, 'matchByName'),
                label: t('policies.matchByName'),
              }),
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

// The single app page: one navigation-rail entry — *Contact Manager* — whose
// body is split into sub-tabs (Overview, Duplicates, Contacts, Groups, Projects,
// Health) with the host's own `Tabs` kit component. Each sub-page mounts the first time
// it is opened and then stays mounted but hidden, so switching tabs keeps a scan
// result or a selected contact instead of throwing the work away.
//
// Every sub-page is handed `onNavigate(tabId)` (how the Overview's rows lead into
// the section they summarise), `revision` (reload when it changes) and
// `onDataChanged()` (bump it after a task that wrote something).
import { Tabs } from '@plugin-host/ui';

export function makeAppShell(React, api, { home, duplicates, contacts, groups, projects, health }) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key) => api.i18n.t(key);
  const tabs = [
    { id: 'home', label: t('home.tab'), component: home },
    { id: 'duplicates', label: t('tab.duplicates'), component: duplicates },
    { id: 'contacts', label: t('page.contactsTitle'), component: contacts },
    { id: 'groups', label: t('groups.tab'), component: groups },
    { id: 'projects', label: t('page.projectsTitle'), component: projects },
    { id: 'health', label: t('health.title'), component: health },
  ];

  return function AppShell() {
    const [active, setActive] = useState('home');
    const [visited, setVisited] = useState([active]);
    // Bumped when a task changes the data, so every sub-page reloads. Without
    // it, importing from the main page left the Contacts list showing the
    // address book as it was when that tab was first opened.
    const [revision, setRevision] = useState(0);

    useEffect(() => {
      setVisited((current) => (current.includes(active) ? current : [...current, active]));
    }, [active]);

    return h('div', null,
      // A little room under the strip: the bar's own height belongs to the kit,
      // but the spacing around it is ours to set.
      h('div', { style: { marginBottom: '0.75rem' } },
        h(Tabs, {
          value: active,
          label: t('page.title'),
          tabs: tabs.map(({ id, label }) => ({ id, label })),
          onChange: setActive,
        })),
      ...tabs
        .filter((tab) => visited.includes(tab.id))
        .map((tab) => h('div', {
          key: tab.id,
          style: tab.id === active ? undefined : { display: 'none' },
        }, h(tab.component, {
          onNavigate: setActive,
          revision,
          onDataChanged: () => setRevision((n) => n + 1),
        }))));
  };
}

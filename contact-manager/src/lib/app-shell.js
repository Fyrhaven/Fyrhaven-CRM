// The single app page: one navigation-rail entry — *Contact Manager* — whose
// body is split into sub-tabs (Duplicates, Contacts, Projects) with the host's
// own `Tabs` kit component. Each sub-page mounts the first time it is opened
// and then stays mounted but hidden, so switching tabs keeps a scan result or
// a selected contact instead of throwing the work away.
import { Tabs } from '@plugin-host/ui';

export function makeAppShell(React, api, { duplicates, contacts, projects, health }) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key) => api.i18n.t(key);
  const tabs = [
    { id: 'duplicates', label: t('tab.duplicates'), component: duplicates },
    { id: 'contacts', label: t('page.contactsTitle'), component: contacts },
    { id: 'projects', label: t('page.projectsTitle'), component: projects },
    { id: 'health', label: t('health.title'), component: health },
  ];

  return function AppShell() {
    const [active, setActive] = useState('duplicates');
    const [visited, setVisited] = useState([active]);

    useEffect(() => {
      setVisited((current) => (current.includes(active) ? current : [...current, active]));
    }, [active]);

    return h('div', null,
      h(Tabs, {
        value: active,
        label: t('page.title'),
        tabs: tabs.map(({ id, label }) => ({ id, label })),
        onChange: setActive,
      }),
      ...tabs
        .filter((tab) => visited.includes(tab.id))
        .map((tab) => h('div', {
          key: tab.id,
          style: tab.id === active ? undefined : { display: 'none' },
        }, h(tab.component))));
  };
}

// The Projects page: client work tracked locally in this browser. The left
// column lists the projects, the right one shows the selected project with its
// linked company and people and its milestones. Each milestone is a real task
// (`api.tasks.create`), so its state is read back from `api.tasks.list`.
//
// Only the milestone tasks and the contact links touch the server; the project
// record itself lives in api.storage and does not sync between devices.

import {
  Badge, Button, Card, EmptyState, Field, Heading, InfoBar, Input, List, ListRow,
  Page, PageHeader, Row, Section, Stack, Text,
} from '@plugin-host/ui';
import { contactName, loadCards } from './contacts.js';
import { openProject, toastProjectResult } from './open-project.js';
import {
  deleteProject, emptyMilestone, milestoneTaskDraft, newId, openMilestoneIds,
  readProjects, saveProject,
} from './projects.js';

export function makeProjectsPage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [cards, setCards] = useState([]);
    const [openTasks, setOpenTasks] = useState([]);
    const [status, setStatus] = useState('loading');
    const [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState({ title: '', due: '' });
    const [error, setError] = useState('');

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [stored, list] = await Promise.all([readProjects(api), loadCards(api).catch(() => [])]);
        setProjects(stored);
        setCards(list);
        setSelectedId((current) => (stored.some((project) => project.id === current) ? current : stored[0]?.id ?? ''));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Milestone state comes from the open-task list; a missing tasks:read must
    // leave the page readable, so the call is optional.
    useEffect(() => {
      let live = true;
      void api.tasks.list({ includeCompleted: false })
        .then((list) => { if (live) setOpenTasks(Array.isArray(list) ? list : []); })
        .catch(() => { if (live) setOpenTasks([]); });
      return () => { live = false; };
    }, [projects]);

    const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
    const selected = useMemo(
      () => projects.find((project) => project.id === selectedId) ?? null,
      [projects, selectedId],
    );
    const nameOf = (id) => {
      const card = byId.get(id);
      return card ? (contactName(card) || id) : id;
    };

    const create = async () => {
      toastProjectResult(api, await openProject(api, { mode: 'create' }));
      void load();
    };

    const edit = async (project) => {
      toastProjectResult(api, await openProject(api, { mode: 'edit', project }));
      void load();
    };

    const addMilestone = async () => {
      const title = draft.title.trim();
      if (!selected || !title) return;
      setError('');
      try {
        const milestone = emptyMilestone(newId('m'), { title, due: draft.due });
        const task = await api.tasks.create(milestoneTaskDraft(selected, milestone));
        await saveProject(api, {
          ...selected,
          milestones: [...selected.milestones, { ...milestone, taskId: task?.id ?? '' }],
        });
        setDraft({ title: '', due: '' });
        void load();
      } catch (err) {
        setError(String(err?.message ?? err));
      }
    };

    const remove = async (project) => {
      const ok = await api.ui.confirm({
        title: t('projects.deleteTitle'),
        message: t('projects.deleteBody', { name: project.name }),
        confirmLabel: t('projects.delete'),
        danger: true,
      });
      if (!ok) return;
      await deleteProject(api, project.id);
      api.toast.success(t('projects.deleted'));
      void load();
    };

    const openIds = new Set(selected ? openMilestoneIds(selected, openTasks) : []);

    const projectCard = () => h(Card, null,
      h(Stack, { gap: 2 },
        h(Row, { gap: 2, wrap: true },
          h(Heading, { level: 2 }, selected.name),
          h(Badge, { tone: 'neutral' }, t(`projects.status.${selected.status}`)),
          selected.companyId ? h(Badge, { tone: 'primary' }, nameOf(selected.companyId)) : null),
        selected.description ? h(Text, { tone: 'muted' }, selected.description) : null,
        selected.contactIds.length
          ? h(Text, { tone: 'muted' }, t('projects.peopleLine', { names: selected.contactIds.map(nameOf).join(', ') }))
          : null,
        h(Row, { gap: 2 },
          h(Button, { size: 'sm', icon: 'edit', onClick: () => void edit(selected) }, t('projects.edit')),
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => void remove(selected) }, t('projects.delete')))));

    const milestonesSection = () => h(Section, {
      title: t('projects.milestones'),
      description: t('projects.milestonesHint'),
    },
      selected.milestones.length
        ? h(Stack, { gap: 1 }, ...selected.milestones.map((milestone) => h(Row, {
          key: milestone.id, gap: 2, wrap: true,
        },
          h(Text, null, milestone.title),
          h(Badge, { tone: openIds.has(milestone.id) ? 'neutral' : 'success' },
            openIds.has(milestone.id) ? t('projects.milestoneOpen') : t('projects.milestoneDone')),
          milestone.due ? h(Text, { tone: 'muted' }, milestone.due) : null)))
        : h(Text, { tone: 'muted' }, t('projects.noMilestones')),
      h(Row, { gap: 2, wrap: true },
        h(Field, { label: t('projects.milestoneTitle') },
          h(Input, {
            value: draft.title,
            onChange: (event) => setDraft((current) => ({ ...current, title: event.target.value })),
          })),
        h(Field, { label: t('projects.milestoneDue') },
          h(Input, {
            value: draft.due,
            onChange: (event) => setDraft((current) => ({ ...current, due: event.target.value })),
          })),
        h(Button, { size: 'sm', onClick: () => void addMilestone() }, t('projects.addMilestone'))),
      error ? h(Text, { tone: 'danger' }, t('projects.milestoneFailed', { reason: error })) : null);

    return h(Page, null,
      h(PageHeader, {
        title: t('page.projectsTitle'),
        description: t('page.projectsDescription'),
        actions: h(Button, { icon: 'plus', onClick: () => void create() }, t('action.newProject')),
      }),
      h(InfoBar, { tone: 'neutral' }, t('projects.localNotice')),
      status === 'loading' ? h(Text, { tone: 'muted' }, t('projects.loading')) : null,
      status === 'error' ? h(EmptyState, { title: t('projects.unavailable') }) : null,
      status === 'ready'
        ? (projects.length
          ? h(Row, { gap: 4 },
            h(Stack, { gap: 2, style: { flex: '0 0 280px', minWidth: '220px' } },
              h(List, { label: t('page.projectsTitle') }, ...projects.map((project) => h(ListRow, {
                key: project.id,
                title: project.name,
                subtitle: t(`projects.status.${project.status}`),
                selected: project.id === selectedId,
                onClick: () => setSelectedId(project.id),
              })))),
            h(Stack, { gap: 4, style: { flex: '1 1 auto', minWidth: '0' } },
              selected
                ? h(React.Fragment, null, projectCard(), milestonesSection())
                : h(EmptyState, { title: t('projects.select') })))
          : h(EmptyState, {
            title: t('projects.empty'),
            actions: h(Button, { onClick: () => void create() }, t('action.newProject')),
          }))
        : null);
  };
}

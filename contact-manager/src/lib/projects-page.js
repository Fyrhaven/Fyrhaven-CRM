// The Projects page: client work tracked locally in this browser. The left
// column lists the projects, the right one shows the selected project with its
// linked company and people and its milestones. Each milestone is a real task
// (`api.tasks.create`), so its state is read back from `api.tasks.list`.
//
// Only the milestone tasks and the contact links touch the server; the project
// record itself lives in api.storage and does not sync between devices.

import {
  Badge, Button, Card, Checkbox, EmptyState, Field, Heading, InfoBar, Input, List, ListRow,
  Page, PageHeader, Row, Section, Stack, Text,
} from '@plugin-host/ui';
import { contactName, loadCards } from './contacts.js';
import { openProject, toastProjectResult } from './open-project.js';
import { downloadBlob } from './download.js';
import { optionalCall } from './optional.js';
import { CONTENT_PANE, HIDDEN, SCROLL_AREA, SPLIT, sidePane } from './layout.js';
import {
  billableExpenses, billableMinutes, deleteProject, emptyExpense, emptyMilestone,
  emptyTimeEntry, exportPayload, formatAmount, formatMinutes, importProjects,
  milestoneTaskDraft, newId, openMilestoneIds, parseExport, projectTotal,
  readProjects, saveProject, totalMinutes,
} from './projects.js';

export function makeProjectsPage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [cards, setCards] = useState([]);
    const [openTasks, setOpenTasks] = useState([]);
    const [status, setStatus] = useState('loading');
    const [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState({ title: '', due: '' });
    const [timeDraft, setTimeDraft] = useState({ at: '', minutes: '', note: '', billable: true });
    const [expenseDraft, setExpenseDraft] = useState({ at: '', amount: '', note: '', billable: true });
    const [error, setError] = useState('');
    const fileRef = useRef(null);

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
      void optionalCall(() => api.tasks.list({ includeCompleted: false }))
        .then((list) => { if (live) setOpenTasks(Array.isArray(list) ? list : []); });
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

    const addTime = async () => {
      const minutes = Math.round(Number(timeDraft.minutes) || 0);
      if (!selected || minutes <= 0) return;
      await saveProject(api, {
        ...selected,
        timeEntries: [...selected.timeEntries, emptyTimeEntry(newId('t'), { ...timeDraft, minutes })],
      });
      setTimeDraft({ at: '', minutes: '', note: '', billable: true });
      void load();
    };

    const removeTime = async (id) => {
      if (!selected) return;
      await saveProject(api, {
        ...selected,
        timeEntries: selected.timeEntries.filter((entry) => entry.id !== id),
      });
      void load();
    };

    const addExpense = async () => {
      const amount = Number(expenseDraft.amount);
      if (!selected || !Number.isFinite(amount) || amount <= 0) return;
      await saveProject(api, {
        ...selected,
        expenses: [...selected.expenses, emptyExpense(newId('e'), { ...expenseDraft, amount })],
      });
      setExpenseDraft({ at: '', amount: '', note: '', billable: true });
      void load();
    };

    const removeExpense = async (id) => {
      if (!selected) return;
      await saveProject(api, {
        ...selected,
        expenses: selected.expenses.filter((entry) => entry.id !== id),
      });
      void load();
    };

    // The portable copy: one JSON file, no server involved.
    const exportAll = () => {
      downloadBlob(
        new Blob([JSON.stringify(exportPayload(projects), null, 2)], { type: 'application/json' }),
        'contact-manager-projects.json',
      );
    };

    const importFile = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const incoming = parseExport(await readText(file));
        if (!incoming.length) {
          api.toast.warning(t('projects.importEmpty'));
          return;
        }
        await importProjects(api, incoming);
        api.toast.success(t('projects.imported', { count: incoming.length }));
        void load();
      } catch (err) {
        api.toast.error(t('projects.importFailed', { reason: String(err?.message ?? err) }));
      }
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
        h(Text, { tone: 'muted' }, t('projects.timeTotal', {
          time: formatMinutes(totalMinutes(selected)),
          billable: formatMinutes(billableMinutes(selected)),
        })),
        h(Text, { tone: 'muted' }, t('projects.amountTotal', {
          amount: formatAmount(projectTotal(selected), selected.currency),
          expenses: formatAmount(billableExpenses(selected), selected.currency),
        })),
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

    const timeSection = () => h(Section, {
      title: t('projects.time'),
      description: t('projects.timeHint'),
    },
      selected.timeEntries.length
        ? h(Stack, { gap: 1 }, ...selected.timeEntries.map((entry) => h(Row, {
          key: entry.id, gap: 2, wrap: true,
        },
          h(Text, null, formatMinutes(entry.minutes)),
          entry.at ? h(Text, { tone: 'muted' }, entry.at) : null,
          entry.note ? h(Text, { tone: 'muted' }, entry.note) : null,
          h(Badge, { tone: entry.billable ? 'success' : 'neutral' },
            entry.billable ? t('projects.billable') : t('projects.notBillable')),
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => void removeTime(entry.id) },
            t('projects.remove')))))
        : h(Text, { tone: 'muted' }, t('projects.noTime')),
      h(Row, { gap: 2, wrap: true },
        h(Field, { label: t('projects.minutes') },
          h(Input, {
            value: timeDraft.minutes,
            onChange: (event) => setTimeDraft((current) => ({ ...current, minutes: event.target.value })),
          })),
        h(Field, { label: t('projects.date') },
          h(Input, {
            value: timeDraft.at,
            onChange: (event) => setTimeDraft((current) => ({ ...current, at: event.target.value })),
          })),
        h(Field, { label: t('projects.note') },
          h(Input, {
            value: timeDraft.note,
            onChange: (event) => setTimeDraft((current) => ({ ...current, note: event.target.value })),
          })),
        h(Checkbox, {
          checked: timeDraft.billable,
          label: t('projects.billable'),
          onChange: (on) => setTimeDraft((current) => ({ ...current, billable: on })),
        }),
        h(Button, { size: 'sm', onClick: () => void addTime() }, t('projects.addTime'))));

    const expensesSection = () => h(Section, {
      title: t('projects.expenses'),
      description: t('projects.expensesHint'),
    },
      selected.expenses.length
        ? h(Stack, { gap: 1 }, ...selected.expenses.map((entry) => h(Row, {
          key: entry.id, gap: 2, wrap: true,
        },
          h(Text, null, formatAmount(entry.amount, selected.currency)),
          entry.at ? h(Text, { tone: 'muted' }, entry.at) : null,
          entry.note ? h(Text, { tone: 'muted' }, entry.note) : null,
          h(Badge, { tone: entry.billable ? 'success' : 'neutral' },
            entry.billable ? t('projects.billable') : t('projects.notBillable')),
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => void removeExpense(entry.id) },
            t('projects.remove')))))
        : h(Text, { tone: 'muted' }, t('projects.noExpenses')),
      h(Row, { gap: 2, wrap: true },
        h(Field, { label: t('projects.amount') },
          h(Input, {
            value: expenseDraft.amount,
            onChange: (event) => setExpenseDraft((current) => ({ ...current, amount: event.target.value })),
          })),
        h(Field, { label: t('projects.date') },
          h(Input, {
            value: expenseDraft.at,
            onChange: (event) => setExpenseDraft((current) => ({ ...current, at: event.target.value })),
          })),
        h(Field, { label: t('projects.note') },
          h(Input, {
            value: expenseDraft.note,
            onChange: (event) => setExpenseDraft((current) => ({ ...current, note: event.target.value })),
          })),
        h(Checkbox, {
          checked: expenseDraft.billable,
          label: t('projects.billable'),
          onChange: (on) => setExpenseDraft((current) => ({ ...current, billable: on })),
        }),
        h(Button, { size: 'sm', onClick: () => void addExpense() }, t('projects.addExpense'))));

    return h(Page, null,
      h(PageHeader, {
        title: t('page.projectsTitle'),
        description: t('page.projectsDescription'),
        actions: h(Row, { gap: 2 },
          h(Button, { icon: 'plus', onClick: () => void create() }, t('action.newProject')),
          h(Button, { variant: 'secondary', icon: 'download', onClick: exportAll }, t('projects.export')),
          h(Button, {
            variant: 'secondary', icon: 'upload', onClick: () => fileRef.current?.click(),
          }, t('projects.import')),
          h('div', { style: HIDDEN },
            h(Input, {
              ref: fileRef,
              type: 'file',
              accept: 'application/json,.json',
              'aria-label': t('projects.import'),
              onChange: importFile,
            }))),
      }),
      h(InfoBar, { tone: 'neutral' }, t('projects.localNotice')),
      status === 'loading' ? h(Text, { tone: 'muted' }, t('projects.loading')) : null,
      status === 'error' ? h(EmptyState, { title: t('projects.unavailable') }) : null,
      status === 'ready'
        ? (projects.length
          ? h('div', { 'data-pane': 'split', style: SPLIT },
            h('div', { 'data-pane': 'list', style: sidePane(280) },
              h('div', { 'data-pane': 'list-scroll', style: SCROLL_AREA },
                h(List, { label: t('page.projectsTitle') }, ...projects.map((project) => h(ListRow, {
                  key: project.id,
                  title: project.name,
                  subtitle: t(`projects.status.${project.status}`),
                  selected: project.id === selectedId,
                  onClick: () => setSelectedId(project.id),
                }))))),
            h('div', { 'data-pane': 'detail', style: CONTENT_PANE },
              selected
                ? h(React.Fragment, null, projectCard(), milestonesSection(), timeSection(), expensesSection())
                : h(EmptyState, { title: t('projects.select') })))
          : h(EmptyState, {
            title: t('projects.empty'),
            actions: h(Button, { onClick: () => void create() }, t('action.newProject')),
          }))
        : null);
  };
}

// Reads a picked file as text, without a library.
function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
    reader.readAsText(file);
  });
}

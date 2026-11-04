// Follow-up tasks (#36, the task-creation half): the payload shape, the due-date
// rules and the overdue split. Pure.
import { describe, expect, it } from 'vitest';
import {
  PRIORITIES, UPCOMING_DAYS, followUpDescription, followUpDraft, isDate, isDueSoon,
  isOverdue, isValidDraft, taskBuckets, taskSummary, todayIso,
} from '../src/lib/tasks.js';

describe('isDate', () => {
  it('accepts the shape <input type=date> writes', () => {
    expect(isDate('2026-11-02')).toBe(true);
    expect(isDate(' 2026-01-01 ')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', '2026-1-1', '02/11/2026', 'tomorrow', null, 42]) {
      expect(isDate(value), String(value)).toBe(false);
    }
  });
});

describe('todayIso', () => {
  it('is the local calendar day, not the UTC one', () => {
    // 23:30 local on the 5th: UTC may already be the 6th, but the user's "today"
    // is the 5th, and that is what a due date is compared against.
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(todayIso(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });
});

describe('followUpDescription', () => {
  it('puts the contact line first, then the notes', () => {
    expect(followUpDescription('ada@example.org', '  ask about the engine '))
      .toBe('ada@example.org\nask about the engine');
  });

  it('drops empty pieces rather than leaving blank lines', () => {
    expect(followUpDescription('ada@example.org', '')).toBe('ada@example.org');
    expect(followUpDescription('', 'note')).toBe('note');
    expect(followUpDescription('', '')).toBe('');
  });
});

describe('followUpDraft', () => {
  it('shapes the payload the milestone tasks already use', () => {
    expect(followUpDraft({ title: 'Follow up', description: 'ada@example.org', due: '2026-12-01' }))
      .toEqual({ title: 'Follow up', description: 'ada@example.org', due: '2026-12-01' });
  });

  it('omits an absent or malformed due date instead of sending an empty string', () => {
    const draft = followUpDraft({ title: 'x', description: '', due: '' });
    expect(draft).not.toHaveProperty('due');
    expect(followUpDraft({ title: 'x', due: 'someday' })).not.toHaveProperty('due');
  });

  it('trims the text it is given', () => {
    expect(followUpDraft({ title: '  Follow up  ', description: '  note  ' }))
      .toEqual({ title: 'Follow up', description: 'note' });
  });
});

describe('isValidDraft', () => {
  it('needs a title and nothing else', () => {
    expect(isValidDraft({ title: 'Follow up' })).toBe(true);
    expect(isValidDraft({ title: '' })).toBe(false);
    expect(isValidDraft({ title: '   ' })).toBe(false);
    expect(isValidDraft(null)).toBe(false);
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 0, 10);

  it('is true only for a due date before today', () => {
    expect(isOverdue({ due: '2026-01-09' }, now)).toBe(true);
    expect(isOverdue({ due: '2026-01-10' }, now)).toBe(false);
    expect(isOverdue({ due: '2026-01-11' }, now)).toBe(false);
  });

  it('never marks a task with no due date overdue', () => {
    expect(isOverdue({ due: '' }, now)).toBe(false);
    expect(isOverdue({}, now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
});

describe('taskBuckets', () => {
  const now = new Date(2026, 0, 10);
  const tasks = [
    { id: 'later', title: 'B later', due: '2026-02-01' },
    { id: 'late-1', title: 'C late', due: '2026-01-01' },
    { id: 'none', title: 'A undated' },
    { id: 'soon', title: 'D tomorrow', due: '2026-01-11' },
    { id: 'late-2', title: 'A late', due: '2026-01-05' },
  ];

  it('splits the overdue from the rest, both in due-date order', () => {
    const { overdue, rest } = taskBuckets(tasks, now);
    expect(overdue.map((task) => task.id)).toEqual(['late-1', 'late-2']);
    // soonest first, and the undated one last
    expect(rest.map((task) => task.id)).toEqual(['soon', 'later', 'none']);
  });

  it('does not mutate the list it is given', () => {
    const list = [...tasks];
    taskBuckets(list, now);
    expect(list.map((task) => task.id)).toEqual(tasks.map((task) => task.id));
  });

  it('reads junk as no tasks', () => {
    expect(taskBuckets(null, now)).toEqual({ overdue: [], rest: [] });
  });
});

describe('isDueSoon', () => {
  const now = new Date(2026, 10, 2); // 2 November 2026, local

  it('is due today, or within the window', () => {
    expect(isDueSoon({ due: '2026-11-02' }, now)).toBe(true);
    expect(isDueSoon({ due: '2026-11-09' }, now)).toBe(true); // exactly the window
  });

  it('is not due soon past the window', () => {
    expect(isDueSoon({ due: '2026-11-10' }, now)).toBe(false);
    expect(isDueSoon({ due: '2027-01-01' }, now)).toBe(false);
  });

  it('never calls an overdue task soon — that is its own bucket', () => {
    expect(isDueSoon({ due: '2026-11-01' }, now)).toBe(false);
  });

  it('counts the window in local calendar days, not milliseconds', () => {
    // The window is `new Date(y, m, d + 7)`, so a month boundary lands where the
    // calendar says rather than 7*24h later.
    // 25 November + 7 days is 2 December, not "the 3rd at the same time".
    expect(isDueSoon({ due: '2026-12-02' }, new Date(2026, 10, 25))).toBe(true);
    expect(isDueSoon({ due: '2026-12-03' }, new Date(2026, 10, 25))).toBe(false);
  });

  it('has no opinion about a task with no due date', () => {
    expect(isDueSoon({ due: '' }, now)).toBe(false);
    expect(isDueSoon({}, now)).toBe(false);
  });

  it('honours a custom window', () => {
    expect(isDueSoon({ due: '2026-11-04' }, now, 1)).toBe(false);
    expect(isDueSoon({ due: '2026-11-03' }, now, 1)).toBe(true);
    expect(UPCOMING_DAYS).toBe(7);
  });
});

describe('taskSummary', () => {
  const now = new Date(2026, 10, 2);
  const tasks = [
    { id: 'late', title: 'C late', due: '2026-10-01' },
    { id: 'soon', title: 'D soon', due: '2026-11-05' },
    { id: 'today', title: 'A today', due: '2026-11-02' },
    { id: 'later', title: 'B later', due: '2027-01-01' },
    { id: 'none', title: 'E undated' },
  ];

  it('splits what is overdue, due soon and can wait', () => {
    const summary = taskSummary(tasks, now);
    expect(summary.overdue.map((task) => task.id)).toEqual(['late']);
    expect(summary.soon.map((task) => task.id)).toEqual(['today', 'soon']);
    expect(summary.later.map((task) => task.id)).toEqual(['later', 'none']);
    expect(summary.total).toBe(5);
  });

  it('reads junk as nothing at all', () => {
    expect(taskSummary(null, now)).toEqual({ overdue: [], soon: [], later: [], total: 0 });
  });
});

describe('the priorities', () => {
  it('are low, normal and high, with normal as the middle', () => {
    expect(PRIORITIES).toEqual(['low', 'normal', 'high']);
  });
});

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  activate: () => activate,
  hooks: () => hooks,
  slots: () => slots
});
module.exports = __toCommonJS(index_exports);

// src/lib/contacts.js
var text = (value) => typeof value === "string" ? value.trim() : "";
function isAddress(value) {
  const address = text(value);
  return address.includes("@") && !/\s/.test(address);
}
function contactName(card) {
  if (!card || typeof card !== "object") return "";
  const name = card.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (name && typeof name === "object") {
    if (text(name.full)) return text(name.full);
    const parts = Array.isArray(name.components) ? name.components : Object.values(name.components ?? {});
    const given = parts.filter((p) => p?.kind === "given").map((p) => text(p.value)).filter(Boolean);
    const surname = parts.filter((p) => p?.kind === "surname").map((p) => text(p.value)).filter(Boolean);
    const joined = [...given, ...surname].join(" ");
    if (joined) return joined;
  }
  if (text(card.fullName)) return text(card.fullName);
  const flat = [text(card.firstName), text(card.lastName)].filter(Boolean).join(" ");
  if (flat) return flat;
  const nick = Object.values(card.nicknames ?? {}).map((n) => text(n?.name)).find(Boolean);
  if (nick) return nick;
  return primaryEmail(card) ?? "";
}
function emailEntries(card) {
  const source = card?.emails;
  if (Array.isArray(source)) {
    return source.map((entry, i) => typeof entry === "string" ? { key: String(i), address: entry } : { key: String(i), ...entry ?? {} }).filter((entry) => isAddress(entry.address));
  }
  return Object.entries(source ?? {}).map(([key, entry]) => typeof entry === "string" ? { key, address: entry } : { key, ...entry ?? {} }).filter((entry) => isAddress(entry.address));
}
function phoneEntries(card) {
  const source = card?.phones ?? card?.phoneNumbers;
  if (Array.isArray(source)) {
    return source.map((entry, i) => {
      if (typeof entry === "string") return { key: String(i), number: entry };
      return { key: String(i), number: entry?.number ?? entry?.phone ?? entry?.value, ...entry ?? {} };
    }).filter((entry) => text(entry.number));
  }
  return Object.entries(source ?? {}).map(([key, entry]) => {
    if (typeof entry === "string") return { key, number: entry };
    return { key, number: entry?.number ?? entry?.phone ?? entry?.value, ...entry ?? {} };
  }).filter((entry) => text(entry.number));
}
function primaryEmail(card) {
  const entries = emailEntries(card).sort((a, b) => (a.pref ?? 101) - (b.pref ?? 101));
  return entries.length ? text(entries[0].address) : null;
}
function primaryPhone(card) {
  const entries = phoneEntries(card).sort((a, b) => (a.pref ?? 101) - (b.pref ?? 101));
  return entries.length ? text(entries[0].number) : null;
}
function bookIds(card) {
  const ids = Object.keys(card?.addressBookIds ?? {});
  if (!ids.length && typeof card?.addressBookId === "string" && card.addressBookId) return [card.addressBookId];
  return ids;
}
function isMergeable(card) {
  return Boolean(card && typeof card.id === "string" && card.id && card.kind !== "group");
}
function bookNamesById(books) {
  const map = /* @__PURE__ */ new Map();
  for (const book of Array.isArray(books) ? books : []) {
    if (book?.id) map.set(book.id, text(book.name) || book.id);
  }
  return map;
}
function matchOptions(settings) {
  return {
    matchByEmail: settings?.matchByEmail !== false,
    matchByPhone: settings?.matchByPhone !== false,
    matchByName: settings?.matchByName !== false
  };
}
async function loadCards(api2) {
  const cards = await api2.contacts.list();
  return Array.isArray(cards) ? cards : [];
}
async function loadBooks(api2) {
  const books = await api2.addressBooks.list();
  return Array.isArray(books) ? books : [];
}

// src/lib/duplicates.js
var text2 = (value) => typeof value === "string" ? value.trim() : "";
function normalizeEmail(address) {
  return text2(address).toLowerCase();
}
function normalizePhone(number) {
  const digits = String(number ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 7 ? digits : "";
}
function normalizeName(value) {
  const base = String(value ?? "").normalize("NFKD").toLowerCase().trim();
  const noMarks = base.replace(/\p{M}/gu, "");
  return noMarks.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function tokens(value) {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(" ").sort() : [];
}
function nameKey(card) {
  return tokens(contactName(card)).join(" ");
}
function coreNameKey(card) {
  const substantial = tokens(contactName(card)).filter((token) => token.length >= 2);
  return substantial.length >= 2 ? substantial.join(" ") : "";
}
function cardKeys(card, opts = {}) {
  const email = opts.matchByEmail === false ? [] : [...new Set(emailEntries(card).map((e) => normalizeEmail(e.address)).filter(Boolean))];
  const phone = opts.matchByPhone === false ? [] : [...new Set(phoneEntries(card).map((p) => normalizePhone(p.number)).filter(Boolean))];
  let name = [];
  let core = [];
  if (opts.matchByName !== false) {
    const full = nameKey(card);
    const coreOnly = coreNameKey(card);
    if (full) name = [full];
    if (coreOnly) core = [coreOnly];
  }
  return { email, phone, name, core };
}
function prefixedKeys(card, opts) {
  const keys = cardKeys(card, opts);
  return [
    ...keys.email.map((v) => ["e:", v]),
    ...keys.phone.map((v) => ["p:", v]),
    ...keys.name.map((v) => ["n:", v]),
    ...keys.core.map((v) => ["c:", v])
  ];
}
var isStrongKey = (prefix) => prefix === "e:" || prefix === "p:";
var reasonType = (prefix) => prefix === "e:" ? "email" : prefix === "p:" ? "phone" : "name";
function signatureOf(members) {
  return `g:${members.map((m) => m.id).slice().sort().join(",")}`;
}
function findDuplicateGroups(cards, opts = {}, dismissed = []) {
  const list = (Array.isArray(cards) ? cards : []).filter(isMergeable);
  const parent = list.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const keysByCard = list.map((card) => prefixedKeys(card, opts));
  const owner = /* @__PURE__ */ new Map();
  keysByCard.forEach((keys, i) => {
    for (const [prefix, value] of keys) {
      const key = prefix + value;
      if (owner.has(key)) union(i, owner.get(key));
      else owner.set(key, i);
    }
  });
  const components = /* @__PURE__ */ new Map();
  keysByCard.forEach((_, i) => {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(i);
  });
  const hidden = new Set(dismissed.filter((s) => typeof s === "string"));
  const groups = [];
  for (const indices of components.values()) {
    if (indices.length < 2) continue;
    const members = indices.slice().sort((a, b) => a - b).map((i) => list[i]);
    const signature = signatureOf(members);
    if (hidden.has(signature)) continue;
    const positionsByKey = /* @__PURE__ */ new Map();
    indices.forEach((cardIndex, position) => {
      for (const [prefix, value] of keysByCard[cardIndex]) {
        const key = prefix + value;
        if (!positionsByKey.has(key)) positionsByKey.set(key, /* @__PURE__ */ new Set());
        positionsByKey.get(key).add(position);
      }
    });
    const reasons = [];
    let strong = false;
    for (const [key, positions] of positionsByKey) {
      if (positions.size < 2) continue;
      const prefix = key.slice(0, 2);
      const value = key.slice(2);
      if (isStrongKey(prefix)) strong = true;
      const type = reasonType(prefix);
      if (!reasons.some((r) => r.type === type && r.value === value)) reasons.push({ type, value });
    }
    if (!reasons.length) continue;
    groups.push({ signature, strength: strong ? "strong" : "possible", reasons, members });
  }
  return groups.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === "strong" ? -1 : 1;
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return contactName(a.members[0]).localeCompare(contactName(b.members[0]));
  });
}
function addressKey(value) {
  if (!value || typeof value !== "object") return "";
  const full = text2(value.full || value.fullAddress);
  if (full) return normalizeName(full);
  const components = Array.isArray(value.components) ? value.components.map((c) => text2(c?.value)).join(" ") : "";
  const flat = [value.street, value.locality, value.region, value.postcode, value.country].map(text2).join(" ");
  return normalizeName(components || flat);
}
var UNION_FIELDS = [
  ["emails", (entry) => normalizeEmail(entry?.address)],
  ["phones", (entry) => normalizePhone(entry?.number ?? entry?.phone ?? entry?.value)],
  ["addresses", addressKey],
  ["onlineServices", (entry) => text2(entry?.uri || entry?.service || entry?.user).toLowerCase()],
  ["links", (entry) => text2(entry?.uri).toLowerCase()],
  ["nicknames", (entry) => normalizeName(entry?.name)],
  ["notes", (entry) => text2(entry?.note)],
  ["anniversaries", (entry) => `${entry?.kind ?? ""}:${JSON.stringify(entry?.date ?? "")}`]
];
var FILL_FIELDS = ["name", "organizations", "titles", "personalInfo", "media"];
var SCORE_FIELDS = [
  "emails",
  "phones",
  "addresses",
  "name",
  "organizations",
  "titles",
  "notes",
  "anniversaries",
  "onlineServices",
  "links",
  "nicknames",
  "personalInfo",
  "media"
];
function populated(value) {
  if (value === void 0 || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
function createdTime(card) {
  const time = Date.parse(card?.created ?? "");
  return Number.isNaN(time) ? null : time;
}
function pickPrimary(members) {
  const score = (card) => SCORE_FIELDS.filter((field) => populated(card[field])).length;
  return members.slice().sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore) return byScore;
    const aCreated = createdTime(a);
    const bCreated = createdTime(b);
    if (aCreated !== bCreated) {
      if (aCreated === null) return 1;
      if (bCreated === null) return -1;
      return aCreated - bCreated;
    }
    return String(a.id).localeCompare(String(b.id));
  })[0];
}
function planMerge(group, keepId) {
  const members = (group?.members ?? []).filter(isMergeable);
  const primary = keepId && members.find((m) => m.id === keepId) || pickPrimary(members) || null;
  const others = members.filter((m) => m !== primary && m.id !== primary?.id);
  const patch = {};
  const added = [];
  if (!primary) return { primary: null, others: [], patch, added };
  for (const [field, normalize] of UNION_FIELDS) {
    const out = { ...primary[field] ?? {} };
    const seen = new Set(Object.values(out).map(normalize).filter(Boolean));
    let changed = false;
    for (const other of others) {
      for (const [key, entry] of Object.entries(other[field] ?? {})) {
        const norm = normalize(entry);
        if (norm && seen.has(norm)) continue;
        let newKey = String(key);
        for (let n = 2; newKey in out; n += 1) newKey = `${key}-${n}`;
        out[newKey] = entry;
        changed = true;
        added.push({ field, value: entry, fromId: other.id });
        if (norm) seen.add(norm);
      }
    }
    if (changed) patch[field] = out;
  }
  const keywords = { ...primary.keywords ?? {} };
  let keywordsChanged = false;
  for (const other of others) {
    for (const [key, on] of Object.entries(other.keywords ?? {})) {
      if (!(key in keywords)) {
        keywords[key] = Boolean(on);
        keywordsChanged = true;
        added.push({ field: "keywords", value: key, fromId: other.id });
      }
    }
  }
  if (keywordsChanged) patch.keywords = keywords;
  for (const field of FILL_FIELDS) {
    if (populated(primary[field])) continue;
    const donor = others.find((m) => populated(m[field]));
    if (donor) {
      patch[field] = donor[field];
      added.push({ field, value: donor[field], fromId: donor.id });
    }
  }
  return { primary, others, patch, added };
}
async function mergeGroups(api2, groups, keepBySignature = {}) {
  let merged = 0;
  let removed = 0;
  const failed = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.members) || group.members.length < 2) continue;
    const plan = planMerge(group, keepBySignature[group.signature]);
    if (!plan.primary || !plan.others.length) continue;
    if (Object.keys(plan.patch).length) {
      try {
        await api2.contacts.update(plan.primary.id, plan.patch);
      } catch {
        failed.push(...plan.others.map((o) => o.id));
        continue;
      }
    }
    merged += 1;
    for (const other of plan.others) {
      try {
        await api2.contacts.remove(other.id);
        removed += 1;
      } catch {
        failed.push(other.id);
      }
    }
  }
  return { merged, removed, failed };
}
var DISMISSED_KEY = "dismissedGroups";
var LAST_SCAN_KEY = "lastScan";
async function readDismissed(api2) {
  const stored = await api2.storage.get(DISMISSED_KEY);
  return Array.isArray(stored) ? stored.filter((s) => typeof s === "string") : [];
}
async function writeDismissed(api2, signatures) {
  await api2.storage.set(DISMISSED_KEY, [...new Set(signatures.filter((s) => typeof s === "string"))]);
}
async function findGroupFor(api2, contact, opts = {}) {
  if (!isMergeable(contact)) return null;
  const queries = [];
  const email = primaryEmail(contact);
  if (email) queries.push(email);
  const name = contactName(contact);
  if (name && !name.includes("@")) queries.push(name);
  const ownKeys = new Set(prefixedKeys(contact, opts).map(([prefix, value]) => prefix + value));
  if (!ownKeys.size) return null;
  const seen = new Set(contact.id ? [contact.id] : []);
  const related = [];
  for (const query of queries.slice(0, 2)) {
    let found = [];
    try {
      found = await api2.contacts.search(query);
    } catch {
      found = [];
    }
    for (const hit of Array.isArray(found) ? found : []) {
      if (!isMergeable(hit) || seen.has(hit.id)) continue;
      seen.add(hit.id);
      const hitKeys = prefixedKeys(hit, opts).map(([prefix, value]) => prefix + value);
      if (hitKeys.some((key) => ownKeys.has(key))) related.push(hit);
    }
    if (related.length) break;
  }
  if (!related.length) return null;
  return findDuplicateGroups([contact, ...related], opts, [])[0] ?? null;
}

// src/lib/labels.js
var strengthKey = (group) => group.strength === "strong" ? "group.strongBadge" : "group.possibleBadge";
var REASON_KEYS = { email: "group.reasonEmail", phone: "group.reasonPhone", name: "group.reasonName" };
function reasonLine(t, group) {
  const parts = (group?.reasons ?? []).map((reason) => {
    const label = t(REASON_KEYS[reason.type] ?? "group.reasonName");
    return reason.type === "name" ? label : `${label}: ${reason.value}`;
  });
  return parts.join(" · ");
}
function memberLabel(card) {
  return [contactName(card), primaryEmail(card), primaryPhone(card)].filter(Boolean).join(" · ");
}
var mergeLabel = (t, count) => count <= 1 ? t("dialog.mergeOne") : t("dialog.mergeN", { count });
function toastMergeResult(api2, result) {
  if (!result) return;
  const vars = { groups: result.merged, removed: result.removed, failed: result.failed };
  if (result.failed) api2.toast.warning(api2.i18n.t("toast.partial", vars));
  else api2.toast.success(api2.i18n.t("toast.merged", vars));
}

// src/lib/manager-page.js
var import_ui = require("@plugin-host/ui");
var FOCUS_COOLDOWN_MS = 5e3;
function makeManagerPage(React2, api2) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React2;
  const t = (key, vars) => api2.i18n.t(key, vars);
  return function ManagerPage() {
    const [status, setStatus] = useState("idle");
    const [error, setError] = useState("");
    const [groups, setGroups] = useState([]);
    const [hiddenGroups, setHiddenGroups] = useState([]);
    const [stats, setStats] = useState(null);
    const [bookNames, setBookNames] = useState(() => /* @__PURE__ */ new Map());
    const [showHidden, setShowHidden] = useState(false);
    const [selected, setSelected] = useState(() => /* @__PURE__ */ new Set());
    const [run, setRun] = useState(0);
    const lastScanAt = useRef(0);
    const scan = useCallback(async () => {
      lastScanAt.current = Date.now();
      setStatus("scanning");
      setError("");
      try {
        const [cards, books, dismissed] = await Promise.all([loadCards(api2), loadBooks(api2), readDismissed(api2)]);
        const hiddenSet = new Set(dismissed);
        const found = findDuplicateGroups(cards, matchOptions(api2.plugin.settings), []);
        const when = (/* @__PURE__ */ new Date()).toISOString();
        setBookNames(bookNamesById(books));
        setGroups(found.filter((group) => !hiddenSet.has(group.signature)));
        setHiddenGroups(found.filter((group) => hiddenSet.has(group.signature)));
        setStats({ when, contacts: cards.length, books: books.length });
        setSelected(/* @__PURE__ */ new Set());
        setStatus("ready");
        await api2.storage.set(LAST_SCAN_KEY, {
          at: when,
          contacts: cards.length,
          books: books.length,
          groups: found.filter((group) => !hiddenSet.has(group.signature)).length
        });
      } catch (err) {
        setError(String(err?.message ?? err));
        setStatus("error");
      }
    }, []);
    useEffect(() => {
      if (api2.plugin.settings.autoScan !== false) void scan();
      return void 0;
    }, [scan]);
    useEffect(() => {
      if (run > 0) void scan();
      return void 0;
    }, [run, scan]);
    useEffect(() => {
      if (api2.plugin.settings.autoScan === false) return void 0;
      const onFocus = () => {
        if (Date.now() - lastScanAt.current > FOCUS_COOLDOWN_MS) void scan();
      };
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, [scan]);
    const openReview = async (list) => {
      if (!list.length) {
        api2.toast.info(t("toast.selectFirst"));
        return;
      }
      const result = await api2.ui.openDialog({
        title: t("dialog.title"),
        slot: "plugin-dialog",
        extraProps: { groups: list }
      });
      toastMergeResult(api2, result);
      if (result) void scan();
    };
    const hide = async (group) => {
      const next = await readDismissed(api2);
      if (!next.includes(group.signature)) next.push(group.signature);
      await writeDismissed(api2, next);
      setGroups((previous) => previous.filter((g) => g.signature !== group.signature));
      setHiddenGroups((previous) => [...previous, group]);
      setSelected((previous) => {
        const updated = new Set(previous);
        updated.delete(group.signature);
        return updated;
      });
      api2.toast.info(t("toast.hidden"));
    };
    const restore = async (group) => {
      await writeDismissed(api2, (await readDismissed(api2)).filter((s) => s !== group.signature));
      setHiddenGroups((previous) => previous.filter((g) => g.signature !== group.signature));
      setGroups((previous) => [...previous, group]);
      api2.toast.info(t("toast.restored"));
    };
    const toggleSelected = (signature, on) => setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(signature);
      else next.delete(signature);
      return next;
    });
    const bookLabel = (member) => {
      const ids = bookIds(member);
      return ids.length ? bookNames.get(ids[0]) ?? "" : "";
    };
    const groupCard = (group) => {
      const plan = planMerge(group);
      const keepId = plan.primary?.id;
      const names = group.members.map(contactName).join(", ");
      return h(
        import_ui.Card,
        { key: group.signature },
        h(
          import_ui.Stack,
          { gap: 2 },
          h(
            import_ui.Row,
            { gap: 2 },
            h(import_ui.Checkbox, {
              checked: selected.has(group.signature),
              ariaLabel: t("group.select", { name: names }),
              onChange: (on) => toggleSelected(group.signature, on)
            }),
            h(import_ui.Badge, { tone: group.strength === "strong" ? "success" : "warning" }, t(strengthKey(group))),
            h(import_ui.Text, { tone: "muted" }, t("group.members", { count: group.members.length }))
          ),
          h(import_ui.Text, { tone: "muted" }, reasonLine(t, group)),
          h(
            import_ui.List,
            { label: names },
            group.members.map((member) => h(import_ui.ListRow, {
              key: member.id,
              title: memberLabel(member),
              subtitle: bookLabel(member),
              meta: member.id === keepId ? [h(import_ui.Badge, { key: "keep", tone: "primary" }, t("group.keepBadge"))] : []
            }))
          ),
          h(
            import_ui.Row,
            { gap: 2 },
            h(import_ui.Button, { size: "sm", icon: "git-merge", onClick: () => void openReview([group]) }, t("action.review")),
            h(import_ui.Button, { size: "sm", variant: "secondary", icon: "eye-off", onClick: () => void hide(group) }, t("action.hide"))
          )
        )
      );
    };
    const strongCount = groups.filter((group) => group.strength === "strong").length;
    const summary = stats ? t("scan.summary", {
      contacts: stats.contacts,
      books: stats.books,
      groups: groups.length,
      strong: strongCount,
      possible: groups.length - strongCount
    }) : "";
    return h(
      import_ui.Page,
      null,
      h(import_ui.PageHeader, {
        title: t("page.title"),
        description: t("page.description"),
        actions: h(
          import_ui.Row,
          { gap: 2 },
          h(
            import_ui.Button,
            { icon: "refresh", busy: status === "scanning", onClick: () => setRun((n) => n + 1) },
            status === "ready" ? t("action.rescan") : t("action.scan")
          ),
          status === "ready" && (showHidden || hiddenGroups.length) ? h(
            import_ui.Button,
            { variant: "secondary", icon: showHidden ? "eye" : "eye-off", onClick: () => setShowHidden((v) => !v) },
            showHidden ? t("action.hideHidden") : t("action.showHidden")
          ) : null
        )
      }),
      status === "scanning" ? h(import_ui.InfoBar, { tone: "primary", title: t("scan.running") }) : null,
      status === "error" ? h(
        import_ui.Stack,
        { gap: 2 },
        h(import_ui.Alert, { tone: "danger" }, t("scan.failed", { reason: error })),
        h(import_ui.Row, null, h(import_ui.Button, { icon: "refresh", onClick: () => setRun((n) => n + 1) }, t("action.retry")))
      ) : null,
      status === "idle" ? h(import_ui.EmptyState, {
        title: t("empty.title"),
        description: t("scan.idle"),
        actions: h(import_ui.Button, { icon: "search", onClick: () => void scan() }, t("empty.action"))
      }) : null,
      status === "ready" ? h(
        import_ui.Stack,
        { gap: 4 },
        h(
          import_ui.InfoBar,
          { tone: groups.length ? "warning" : "success", title: summary },
          h(
            import_ui.Text,
            { tone: "muted" },
            t("scan.last", { when: new Date(stats.when).toLocaleString(api2.i18n.getLocale()) })
          )
        ),
        selected.size ? h(
          import_ui.Row,
          { gap: 2 },
          h(
            import_ui.Button,
            { icon: "git-merge", onClick: () => void openReview(groups.filter((g) => selected.has(g.signature))) },
            mergeLabel(t, selected.size)
          ),
          h(import_ui.Button, { variant: "secondary", onClick: () => setSelected(/* @__PURE__ */ new Set()) }, t("dialog.cancel"))
        ) : null,
        groups.length === 0 ? h(import_ui.EmptyState, { title: t("scan.clean") }) : null,
        ...groups.map(groupCard),
        showHidden ? h(
          import_ui.Stack,
          { gap: 2 },
          h(import_ui.Heading, { level: 3 }, t("action.showHidden")),
          hiddenGroups.length === 0 ? h(import_ui.Text, { tone: "muted" }, t("scan.clean")) : null,
          ...hiddenGroups.map((group) => h(
            import_ui.Row,
            { key: group.signature, gap: 2 },
            h(import_ui.Text, null, group.members.map(contactName).join(", ")),
            h(
              import_ui.Button,
              { size: "sm", variant: "secondary", icon: "undo", onClick: () => void restore(group) },
              t("action.restore")
            )
          ))
        ) : null
      ) : null
    );
  };
}

// src/lib/review-dialog.js
var import_ui2 = require("@plugin-host/ui");

// src/lib/preview.js
var text3 = (value) => typeof value === "string" ? value.trim() : "";
var trunc = (value, max = 120) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
function formatAddress(address) {
  if (!address || typeof address !== "object") return "";
  const full = text3(address.full || address.fullAddress);
  if (full) return full;
  const components = Array.isArray(address.components) ? address.components.map((c) => text3(c?.value)).filter(Boolean).join(" ") : "";
  const flat = [address.street, address.locality, address.region, address.postcode, address.country].map(text3).filter(Boolean).join(" ");
  return trunc(components || flat, 80);
}
function formatAnniversary(anniversary) {
  if (!anniversary || typeof anniversary !== "object") return "";
  const kind = text3(anniversary.kind);
  const date = anniversary.date;
  let when = "";
  if (typeof date === "string") when = date;
  else if (date && typeof date === "object") {
    if (typeof date.utc === "string") when = date.utc.slice(0, 10);
    else if (date.year || date.month || date.day) {
      when = [date.year, date.month, date.day].map((part) => part === void 0 || part === null ? "" : String(part).padStart(2, "0")).filter(Boolean).join("-");
    }
  }
  return [kind, when].filter(Boolean).join(" ");
}
var DISPLAY = {
  name: (value) => contactName({ name: value }),
  emails: (value) => text3(value?.address),
  phones: (value) => text3(value?.number),
  addresses: formatAddress,
  organizations: (value) => text3(value?.name),
  titles: (value) => text3(value?.name),
  nicknames: (value) => text3(value?.name),
  onlineServices: (value) => text3(value?.uri || (value?.service ? `${value.service}${value.user ? `: ${value.user}` : ""}` : value?.user)),
  links: (value) => text3(value?.uri),
  notes: (value) => trunc(text3(value?.note)),
  anniversaries: formatAnniversary,
  keywords: (value) => text3(value),
  personalInfo: (value) => text3(value?.value),
  media: (value) => text3(value?.uri)
};
var PREVIEW_FIELDS = [
  ["name", "dialog.field.name"],
  ["emails", "dialog.field.email"],
  ["phones", "dialog.field.phone"],
  ["addresses", "dialog.field.address"],
  ["organizations", "dialog.field.organization"],
  ["titles", "dialog.field.title"],
  ["nicknames", "dialog.field.nickname"],
  ["onlineServices", "dialog.field.online"],
  ["links", "dialog.field.link"],
  ["notes", "dialog.field.note"],
  ["anniversaries", "dialog.field.anniversary"],
  ["keywords", "dialog.field.keyword"],
  ["personalInfo", "dialog.field.personal"],
  ["media", "dialog.field.media"]
];
function keptValues(primary, field) {
  if (!primary) return [];
  if (field === "name") return primary.name ? [DISPLAY.name(primary.name)].filter(Boolean) : [];
  if (field === "keywords") return Object.keys(primary.keywords ?? {});
  return Object.values(primary[field] ?? {}).map(DISPLAY[field]).filter(Boolean);
}
function previewFields(plan) {
  const out = [];
  for (const [field, labelKey] of PREVIEW_FIELDS) {
    const kept = keptValues(plan?.primary, field);
    const added = (plan?.added ?? []).filter((entry) => entry.field === field).map((entry) => ({ value: DISPLAY[field](entry.value), fromId: entry.fromId })).filter((entry) => entry.value);
    if (!kept.length && !added.length) continue;
    out.push({ field, labelKey, kept, added });
  }
  return out;
}
function memberDetails(card, booksById) {
  const orgs = Object.values(card?.organizations ?? {}).map((o) => text3(o?.name)).filter(Boolean);
  const titles = Object.values(card?.titles ?? {}).map((title) => text3(title?.name)).filter(Boolean);
  const books = bookIds(card).map((id) => booksById?.get?.(id) ?? "").filter(Boolean);
  const meta = [...orgs, ...titles, ...books];
  if (text3(card?.created)) meta.push(text3(card.created).slice(0, 10));
  return {
    name: contactName(card) || primaryText(card) || text3(card?.id),
    meta: meta.join(" · "),
    emails: emailEntries(card).map((e) => text3(e.address)),
    phones: phoneEntries(card).map((p) => text3(p.number)),
    addresses: Object.values(card?.addresses ?? {}).map(formatAddress).filter(Boolean),
    notes: Object.values(card?.notes ?? {}).map((note) => trunc(text3(note?.note))).filter(Boolean),
    keywords: Object.keys(card?.keywords ?? {})
  };
}
function primaryText(card) {
  return emailEntries(card)[0]?.address ? text3(emailEntries(card)[0].address) : "";
}

// src/lib/review-dialog.js
function makeReviewDialog(React2, api2) {
  const { createElement: h, useState } = React2;
  const t = (key, vars) => api2.i18n.t(key, vars);
  return function ReviewDialog(props) {
    const groups = (Array.isArray(props.groups) ? props.groups : []).filter((group) => Array.isArray(group.members) && group.members.length > 1);
    const [included, setIncluded] = useState(() => new Set(groups.map((g) => g.signature)));
    const [keepBy, setKeepBy] = useState(() => Object.fromEntries(groups.map((g) => [g.signature, planMerge(g).primary?.id ?? ""])));
    const [busy, setBusy] = useState(false);
    const close = (value) => props.onResult?.(value);
    const chosen = groups.filter((group) => included.has(group.signature));
    const removeCount = chosen.reduce((n, group) => n + group.members.length - 1, 0);
    const toggle = (signature, on) => setIncluded((previous) => {
      const next = new Set(previous);
      if (on) next.add(signature);
      else next.delete(signature);
      return next;
    });
    const merge = async () => {
      if (!chosen.length || busy) return;
      const ok = await api2.ui.confirm({
        title: mergeLabel(t, chosen.length),
        message: t("dialog.confirmBody", { keep: chosen.length, remove: removeCount }),
        confirmLabel: mergeLabel(t, chosen.length),
        danger: true
      });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await mergeGroups(api2, chosen, keepBy);
        close({ merged: result.merged, removed: result.removed, failed: result.failed.length });
      } catch (err) {
        api2.toast.error(t("scan.failed", { reason: String(err?.message ?? err) }));
        setBusy(false);
      }
    };
    if (!groups.length) {
      return h(
        import_ui2.Stack,
        { gap: 4 },
        h(import_ui2.Text, { tone: "muted" }, t("dialog.none")),
        h(import_ui2.DialogButtons, {
          buttons: [{ id: "cancel", label: t("dialog.cancel"), variant: "secondary" }],
          onClick: () => close(null)
        })
      );
    }
    const renderMember = (member, keepId) => {
      const isKeep = member.id === keepId;
      const details = memberDetails(member);
      return h(
        import_ui2.Row,
        { key: member.id, gap: 2, wrap: true },
        h(
          import_ui2.Text,
          {
            tone: isKeep ? void 0 : "muted",
            style: { fontWeight: isKeep ? "bold" : "normal", whiteSpace: "nowrap" }
          },
          `${isKeep ? "✓ " : ""}${contactName(member) || member.id}`
        ),
        details.emails.length > 0 ? h(
          import_ui2.Stack,
          { gap: 0 },
          ...details.emails.map((email, i) => h(import_ui2.Chip, { key: `e${i}`, label: email }))
        ) : null,
        details.phones.length > 0 ? h(
          import_ui2.Stack,
          { gap: 0 },
          ...details.phones.map((phone, i) => h(import_ui2.Chip, { key: `p${i}`, label: phone }))
        ) : null,
        details.meta ? h(import_ui2.Text, { tone: "muted", style: { fontSize: "11px" } }, details.meta) : null
      );
    };
    const renderFieldPreview = (fieldPreview, donorById) => {
      const { field, labelKey, kept, added } = fieldPreview;
      const label = t(labelKey);
      return h(
        import_ui2.Row,
        { key: field, gap: 2, wrap: true },
        h(import_ui2.Text, { style: { fontWeight: "600", minWidth: "120px", whiteSpace: "nowrap" } }, label),
        h(import_ui2.Text, { tone: "muted", style: { fontSize: "11px" } }, `kept:`),
        kept.length > 0 ? h(
          import_ui2.Stack,
          { gap: 0 },
          ...kept.map((value, i) => h(import_ui2.Chip, { key: `k${i}`, label: value }))
        ) : h(import_ui2.Text, { tone: "muted", style: { fontSize: "11px" } }, "—"),
        added.length > 0 ? h(
          import_ui2.Stack,
          { gap: 0 },
          ...added.map((entry, i) => h(import_ui2.Chip, {
            key: `a${i}`,
            label: `+ ${entry.value}`,
            tone: "success"
          }))
        ) : null,
        added.length > 0 ? h(
          import_ui2.Text,
          { tone: "muted", style: { fontSize: "10px" } },
          `from ${added.map((e) => donorById[e.fromId] || e.fromId).join(", ")}`
        ) : null
      );
    };
    return h(
      import_ui2.Stack,
      { gap: 4 },
      h(import_ui2.Text, { tone: "muted" }, t("dialog.intro")),
      ...groups.map((group) => {
        const signature = group.signature;
        const keepId = keepBy[signature] || planMerge(group).primary?.id || "";
        const plan = planMerge(group, keepId);
        const nameById = Object.fromEntries(group.members.map((m) => [m.id, contactName(m) || m.id]));
        const keptName = contactName(plan.primary) || plan.primary?.id || "";
        return h(
          import_ui2.Card,
          { key: signature },
          h(
            import_ui2.Stack,
            { gap: 2 },
            h(
              import_ui2.Row,
              { gap: 2 },
              h(import_ui2.Checkbox, {
                checked: included.has(signature),
                label: t("dialog.include"),
                ariaLabel: `${t("dialog.include")}: ${group.members.map(contactName).join(", ")}`,
                onChange: (on) => toggle(signature, on)
              }),
              h(import_ui2.Badge, { tone: group.strength === "strong" ? "success" : "warning" }, t(strengthKey(group))),
              h(import_ui2.Text, { tone: "muted" }, t("group.members", { count: group.members.length }))
            ),
            h(import_ui2.Text, { tone: "muted" }, reasonLine(t, group)),
            h(
              import_ui2.Field,
              { label: t("dialog.keep") },
              h(import_ui2.Select, {
                value: keepId,
                options: group.members.map((m) => ({ value: m.id, label: memberLabel(m) })),
                onChange: (value) => setKeepBy((previous) => ({ ...previous, [signature]: value }))
              })
            ),
            // Member roster — full details so duplicates that share a name can be told apart.
            h(
              import_ui2.Section,
              { title: t("dialog.membersTitle") },
              ...group.members.map((member) => renderMember(member, keepId))
            ),
            // Comprehensive merge preview: every field that exists or will be added.
            plan && plan.added.length > 0 ? h(
              import_ui2.Section,
              { title: t("dialog.previewTitle", { name: keptName }) },
              ...previewFields(plan).map((fieldPreview) => renderFieldPreview(fieldPreview, nameById)),
              h(import_ui2.InfoBar, { tone: "info", title: t("dialog.previewNote") })
            ) : null
          )
        );
      }),
      h(import_ui2.DialogButtons, {
        buttons: [
          { id: "cancel", label: t("dialog.cancel"), variant: "secondary" },
          { id: "merge", label: mergeLabel(t, chosen.length), variant: "primary", disabled: !chosen.length || busy, busy }
        ],
        onClick: (id) => {
          if (id === "merge") void merge();
          else close(null);
        }
      })
    );
  };
}

// src/lib/detail-section.js
var import_ui3 = require("@plugin-host/ui");
function makeDuplicateSection(React2, api2) {
  const { createElement: h, useCallback, useEffect, useState } = React2;
  const t = (key, vars) => api2.i18n.t(key, vars);
  return function DuplicateSection(props) {
    const contact = props.contact ?? null;
    const [state, setState] = useState({ status: "checking", group: null, reason: "" });
    const [run, setRun] = useState(0);
    const check = useCallback(async () => {
      if (!contact) {
        setState({ status: "none", group: null, reason: "" });
        return;
      }
      setState({ status: "checking", group: null, reason: "" });
      try {
        const group = await findGroupFor(api2, contact, matchOptions(api2.plugin.settings));
        setState({ status: group ? "found" : "none", group, reason: "" });
      } catch (err) {
        setState({ status: "error", group: null, reason: String(err?.message ?? err) });
      }
    }, [contact?.id, run]);
    useEffect(() => {
      void check();
    }, [check]);
    const review = async () => {
      if (!state.group) return;
      const result = await api2.ui.openDialog({
        title: t("dialog.title"),
        slot: "plugin-dialog",
        extraProps: { groups: [state.group] }
      });
      toastMergeResult(api2, result);
      if (result) setRun((n) => n + 1);
    };
    return h(
      import_ui3.Stack,
      { gap: 2 },
      h(import_ui3.Heading, { level: 4 }, t("detail.title")),
      state.status === "checking" ? h(import_ui3.Text, { tone: "muted" }, t("detail.checking")) : null,
      state.status === "none" ? h(import_ui3.Text, { tone: "muted" }, t("detail.none")) : null,
      state.status === "error" ? h(import_ui3.Text, { tone: "muted" }, t("detail.failed", { reason: state.reason })) : null,
      state.status === "found" && state.group ? h(
        import_ui3.Stack,
        { gap: 2 },
        h(
          import_ui3.Row,
          { gap: 2 },
          h(
            import_ui3.Badge,
            { tone: state.group.strength === "strong" ? "success" : "warning" },
            t("detail.found", { count: state.group.members.length - 1 })
          ),
          h(import_ui3.Text, { tone: "muted" }, reasonLine(t, state.group))
        ),
        ...state.group.members.map((member) => h(import_ui3.Text, { key: member.id, tone: "muted" }, memberLabel(member))),
        h(
          import_ui3.Row,
          { gap: 2 },
          h(import_ui3.Button, { size: "sm", icon: "git-merge", onClick: () => void review() }, t("detail.review"))
        )
      ) : null
    );
  };
}

// src/index.js
var React = require("react");
var api = require("@plugin-host");
var enabled = (pluginApi) => pluginApi.plugin.settings.enabled !== false;
async function scanGroups(pluginApi, scopeIds = null) {
  const cards = await loadCards(pluginApi);
  const list = scopeIds ? cards.filter((card) => scopeIds.has(card.id)) : cards;
  const dismissed = scopeIds ? [] : await readDismissed(pluginApi);
  return findDuplicateGroups(list, matchOptions(pluginApi.plugin.settings), dismissed);
}
async function scanAndReview(pluginApi, scopeIds = null) {
  let groups;
  try {
    groups = await scanGroups(pluginApi, scopeIds);
  } catch (err) {
    pluginApi.toast.error(pluginApi.i18n.t("scan.failed", { reason: String(err?.message ?? err) }));
    return;
  }
  if (!groups.length) {
    pluginApi.toast.info(pluginApi.i18n.t("toast.clean"));
    return;
  }
  const result = await pluginApi.ui.openDialog({
    title: pluginApi.i18n.t("dialog.title"),
    slot: "plugin-dialog",
    extraProps: { groups }
  });
  toastMergeResult(pluginApi, result);
}
var slots = {
  // The Contact Manager page at /apps/contact-manager/duplicates.
  "app-page": {
    component: makeManagerPage(React, api),
    shouldShow: () => enabled(api)
  },
  // Review and merge, opened from the page, the palette and the list toolbar.
  "plugin-dialog": {
    component: makeReviewDialog(React, api)
  },
  // The duplicate hint in a contact's details.
  "contact-detail-section": {
    component: makeDuplicateSection(React, api),
    shouldShow: () => enabled(api)
  }
};
var hooks = {
  // Clicks on the buttons declared with api.ui.setActions — no own permission.
  async onAction({ surface, actionId, context }) {
    if (actionId === "scan") {
      await scanAndReview(api);
      return;
    }
    if (actionId === "scan-selection") {
      const ids = context?.contactIds;
      if (!Array.isArray(ids) || !ids.length) {
        api.toast.info(api.i18n.t("toast.needSelection"));
        return;
      }
      await scanAndReview(api, new Set(ids));
    }
  }
};
async function publish(pluginApi) {
  if (!enabled(pluginApi)) {
    await pluginApi.ui.setPages([]);
    await pluginApi.ui.setActions("command-palette", []);
    await pluginApi.ui.setActions("contact-list-actions", []);
    return;
  }
  const t = (key) => pluginApi.i18n.t(key);
  await pluginApi.ui.setPages([{ id: "duplicates", title: t("page.title"), icon: "users" }]);
  await pluginApi.ui.setActions("command-palette", [
    { id: "scan", label: t("action.scanCommand"), icon: "copy" }
  ]);
  await pluginApi.ui.setActions("contact-list-actions", [
    { id: "scan-selection", label: t("action.selectionCommand"), icon: "copy" }
  ]);
}
async function activate(pluginApi) {
  try {
    await publish(pluginApi);
  } catch (err) {
    pluginApi.log.warn(`publish failed: ${err.message}`);
  }
  pluginApi.i18n.onLocaleChange(() => {
    void publish(pluginApi).catch(() => {
    });
  });
  pluginApi.plugin.onSettingsChange(() => {
    void publish(pluginApi).catch(() => {
    });
  });
}

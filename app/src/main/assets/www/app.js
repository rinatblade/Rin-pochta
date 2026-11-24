(function () {
'use strict';

/* ================= Утилиты и хранилище ================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'rp.v1';
let S = { parcels: [], theme: 0, font: 'Roboto', web: true, keys: { t17: '', aftership: '' } };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
S.keys = Object.assign({ t17: '', aftership: '' }, S.keys || {});
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const A = window.Android || null;
const uid = () => Math.random().toString(36).slice(2, 10);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ================= Тема и шрифт ================= */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function applyTheme() {
  const t = THEMES[S.theme] || THEMES[0];
  const [, mode, bg, acc, acc2] = t;
  const r = document.documentElement;
  r.classList.toggle('light', mode === 'light');
  r.style.setProperty('--bg', 'linear-gradient(160deg,' + bg.join(',') + ')');
  r.style.setProperty('--acc', acc);
  r.style.setProperty('--acc2', acc2 || acc);
  r.style.setProperty('--on-acc', (lum(acc) + lum(acc2 || acc)) / 2 > 0.42 ? '#1b1b1b' : '#ffffff');
  if (A && A.setBars) { try { A.setBars(bg[0], mode === 'dark'); } catch (e) {} }
}
const gfLoaded = {};
function loadGoogleFonts(names, id) {
  if (gfLoaded[id]) return; gfLoaded[id] = 1;
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?' + names.map((n) => 'family=' + encodeURIComponent(n).replace(/%20/g, '+')).join('&') + '&display=swap';
  document.head.appendChild(l);
}
function applyFont() {
  const f = FONTS.find((x) => x[0] === S.font) || FONTS[0];
  document.documentElement.style.setProperty('--font', "'" + f[0] + "', system-ui, -apple-system, 'Segoe UI', " + (f[1] === 'monospace' ? 'monospace' : f[1] === 'serif' ? 'serif' : 'sans-serif'));
  loadGoogleFonts([f[0]], 'f-' + f[0]);
}

/* ================= Мост HTTP ================= */
const pending = {};
window.__http = (id, status, body) => {
  const p = pending[id]; if (!p) return; delete pending[id]; p.res({ status, body });
};
function http(url, opt) {
  opt = opt || {};
  if (A && A.http) {
    return new Promise((res, rej) => {
      const id = uid(); pending[id] = { res, rej };
      A.http(id, opt.method || 'GET', url, JSON.stringify(opt.headers || {}), opt.body || '');
      setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error('таймаут')); } }, 30000);
    });
  }
  return fetch(url, { method: opt.method || 'GET', headers: opt.headers, body: opt.body || undefined })
    .then((r) => r.text().then((b) => ({ status: r.status, body: b })));
}

/* ================= Распознавание номеров ================= */
function norm(n) { return String(n || '').trim().toUpperCase().replace(/[\s]+/g, ''); }
function detect(n) {
  n = norm(n);
  if (/^\d{6}-\d{9,}$/.test(n)) return { kind: 'pdd', label: 'Заказ Pinduoduo', country: 'CN' };
  if (/^\d{15,17}$/.test(n)) return { kind: 'ali', label: 'Заказ AliExpress', country: 'CN' };
  let m = n.match(/^[A-Z]{2}\d{9}([A-Z]{2})$/);
  if (m) {
    if (m[1] === 'KZ') return { kind: 'track', label: 'Казпочта', country: 'KZ' };
    if (m[1] === 'CN') return { kind: 'track', label: 'Почта Китая', country: 'CN' };
    return { kind: 'track', label: 'Международный (' + m[1] + ')', country: m[1] };
  }
  if (/^LP\d{10,}/.test(n)) return { kind: 'track', label: 'Cainiao / AliExpress', country: 'CN' };
  if (/^AE[A-Z0-9]{8,}/.test(n)) return { kind: 'track', label: 'AliExpress Standard', country: 'CN' };
  if (/^YT\d{10,}/.test(n)) return { kind: 'track', label: 'Yun Express', country: 'CN' };
  if (/^SF\d{8,}/.test(n)) return { kind: 'track', label: 'SF Express', country: 'CN' };
  if (/^JT\d{8,}|^JD[A-Z0-9]{8,}/.test(n)) return { kind: 'track', label: 'J&T / JD', country: 'CN' };
  if (/^\d{10}$/.test(n)) return { kind: 'track', label: 'Курьер (CDEK и др.)', country: '' };
  if (/^\d{8,14}$/.test(n)) return { kind: 'track', label: 'Трек-номер', country: '' };
  return { kind: 'track', label: 'Трек-номер', country: '' };
}

/* ================= Этапы пути ================= */
const STAGES = ['Принят', 'Отправлен', 'Таможня КНР', 'В пути', 'Прибыл в КЗ', 'Доставка', 'Вручено'];
const STAGE_FULL = ['Заказ принят', 'Отправлен из Китая', 'Экспорт / таможня Китая', 'В международном пути', 'Прибыл в Казахстан', 'Доставка по Казахстану', 'Вручено получателю'];
const KZ_RE = /казахстан|kazakhstan|алматы|almaty|астана|astana|нур-султан|шымкент|shymkent|караганд|karaganda|актобе|aktobe|атырау|atyrau|павлодар|pavlodar|семей|костанай|тараз|актау|aktau|петропавловск|усть-каменогорск|oral|уральск|\bkz\b|казпочт|kazpost|хоргос|khorgos|алтынколь/i;
function classify(text, fromKz) {
  const s = String(text).toLowerCase();
  if (/вручен|delivered|выдан получател|signed|签收|received by (the )?(addressee|recipient)|получен получателем/.test(s)) return 6;
  if (/ожида\w* (вручени|получени)|готов\w* к выдаче|к выдаче|в отделении|в почтомат|ready for (pick|collect)|awaiting collection|out for delivery|на доставк|передан\w* курьер|курьер|arrived at (the )?(delivery|post)|самовывоз|ожидает в|пункт выдачи/.test(s)) return 5;
  if (KZ_RE.test(s) || /импорт|import/.test(s)) return 4;
  if (fromKz) return 4;
  if (/customs|тамож|清关|export|экспорт|出口|离境|left (the )?(origin|china)|departed (from )?(china|origin)|leaving/.test(s)) return 2;
  if (/transit|в пути|international|междун|вылет|рейс|flight|departed|arrived|прибыл|sort|сортиров|hub|transport|транспорт|покинул|отправлен в/.test(s)) return 3;
  if (/picked up|pick-up|collected|accepted|принят|принято|получен от|shipped|отправлен|揽收|dispatch|label|создан|created|processing/.test(s)) return 1;
  return 1;
}
function calcStage(p) {
  if (!p.events.length) return -1;
  let st = 0;
  const kzNums = new Set(p.numbers.filter((x) => detect(x.n).country === 'KZ').map((x) => x.n));
  for (const e of p.events) { const c = classify(e.text + ' ' + (e.place || ''), kzNums.has(e.num)); if (c > st) st = c; }
  return st;
}

/* ================= Перевод типовых фраз ================= */
const RU = [
  [/out for delivery/gi, 'Передано курьеру для доставки'], [/delivered/gi, 'Вручено'],
  [/arrived at destination (country|port)/gi, 'Прибыло в страну назначения'],
  [/departed from (the )?origin/gi, 'Покинуло страну отправления'],
  [/export customs clearance (completed|complete)/gi, 'Экспортная таможня пройдена'],
  [/import customs clearance (completed|complete)/gi, 'Импортная таможня пройдена'],
  [/customs clearance/gi, 'Таможенное оформление'], [/in transit/gi, 'В пути'],
  [/shipment (picked up|collected)/gi, 'Посылка забрана у отправителя'],
  [/picked up/gi, 'Забрано'], [/arrived at/gi, 'Прибыло в'], [/departed from/gi, 'Покинуло'],
  [/sorting center/gi, 'сортировочный центр'], [/processing center/gi, 'сортировочный центр'],
  [/handed over to/gi, 'Передано в'], [/airport/gi, 'аэропорт'], [/warehouse/gi, 'склад'],
  [/order (created|placed)/gi, 'Заказ создан'], [/received by/gi, 'Получено'],
];
function ru(t) { let s = String(t || ''); for (const [re, to] of RU) s = s.replace(re, to); return s; }

/* ================= Разбор ответов ================= */
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { if (v > 1e12) return v; if (v > 1e9) return v * 1000; return null; }
  v = String(v).trim();
  if (/^\d{13}$/.test(v)) return +v; if (/^\d{10}$/.test(v)) return +v * 1000;
  let m = v.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})[ T,]*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  const d = Date.parse(v); return isNaN(d) ? null : d;
}
const TXT_KEYS = ['desc', 'description', 'standerddesc', 'activity', 'status', 'message', 'event', 'operation', 'info', 'content', 'state', 'detail', 'remark', 'statusdescription', 'status_description'];
const PLC_KEYS = ['location', 'place', 'city', 'address', 'region', 'office', 'areaname', 'locationname', 'postoffice'];
const TIME_RE = /(time|date|dt|when|moment|created|occur)/i;
function lowerMap(o) { const m = {}; for (const k in o) m[k.toLowerCase()] = o[k]; return m; }
function toEv(o) {
  let t = null;
  for (const k in o) { const v = o[k]; if (v == null || typeof v === 'object') continue; if (TIME_RE.test(k)) { const pt = parseTime(v); if (pt) { t = pt; break; } } }
  if (!t) return null;
  const m = lowerMap(o);
  let x = '', p = '';
  for (const k of TXT_KEYS) { if (typeof m[k] === 'string' && m[k].trim()) { x = m[k].trim(); break; } }
  for (const k of PLC_KEYS) { if (typeof m[k] === 'string' && m[k].trim()) { p = m[k].trim(); break; } }
  if (!x) return null;
  return { t, text: x, place: p };
}
function genericEvents(root) {
  const out = [];
  (function walk(o) {
    if (Array.isArray(o)) {
      if (o.length && o.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        const ev = o.map(toEv).filter(Boolean);
        if (ev.length && ev.length >= o.length * 0.6) { out.push.apply(out, ev); return; }
      }
      o.forEach(walk);
    } else if (o && typeof o === 'object') { Object.keys(o).forEach((k) => walk(o[k])); }
  })(root);
  return out;
}
function parseJson(body) {
  try { return JSON.parse(body); } catch (e) { return null; }
}

/* ================= Источники данных ================= */
const PROVIDERS = [
  {
    id: 'cainiao', name: 'Cainiao', desc: 'AliExpress, Китай → мир (без ключа)',
    applies: (d) => d.country !== 'KZ',
    async run(n) {
      const r = await http('https://global.cainiao.com/global/detail.json?mailNos=' + encodeURIComponent(n) + '&lang=en-US&language=en-US');
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = parseJson(r.body); if (!j) throw new Error('ответ не JSON (нужна проверка на сайте)');
      const mod = j.module && j.module[0];
      let ev = [];
      if (mod && Array.isArray(mod.detailList)) {
        ev = mod.detailList.map((d) => ({ t: d.time || parseTime(d.timeStr), text: d.desc || d.standerdDesc || '', place: d.areaName || '' })).filter((e) => e.t && e.text);
      }
      if (!ev.length) ev = genericEvents(j);
      return ev;
    },
  },
  {
    id: 'kazpost', name: 'Казпочта', desc: 'Казахстан до места получения (без ключа)',
    applies: (d) => d.country === 'KZ' || d.country === '',
    async run(n) {
      const r = await http('https://post.kz/mail/search/track/' + encodeURIComponent(n) + '/detail');
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = parseJson(r.body); if (!j) throw new Error('ответ не JSON');
      return genericEvents(j);
    },
  },
  {
    id: 't17', name: '17TRACK', desc: '2000+ перевозчиков (нужен API-ключ)', key: 't17',
    async run(n) {
      const h = { '17token': S.keys.t17, 'Content-Type': 'application/json' };
      const base = 'https://api.17track.net/track/v2.2/';
      try { await http(base + 'register', { method: 'POST', headers: h, body: JSON.stringify([{ number: n }]) }); } catch (e) {}
      const r = await http(base + 'gettrackinfo', { method: 'POST', headers: h, body: JSON.stringify([{ number: n }]) });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = parseJson(r.body); if (!j) throw new Error('ответ не JSON');
      const acc = j.data && j.data.accepted && j.data.accepted[0];
      if (!acc) throw new Error('номер в очереди — обновите через минуту');
      const provs = (acc.track_info && acc.track_info.tracking && acc.track_info.tracking.providers) || [];
      const ev = [];
      provs.forEach((p) => (p.events || []).forEach((e) => {
        const t = parseTime(e.time_iso || e.time_utc || (e.time_raw && e.time_raw.date));
        if (t && e.description) ev.push({ t, text: e.description, place: e.location || '' });
      }));
      return ev.length ? ev : genericEvents(j);
    },
  },
  {
    id: 'aftership', name: 'AfterShip', desc: '900+ перевозчиков (нужен API-ключ)', key: 'aftership',
    async run(n) {
      const h = { 'as-api-key': S.keys.aftership, 'Content-Type': 'application/json' };
      const base = 'https://api.aftership.com/tracking/2024-07/trackings';
      try { await http(base, { method: 'POST', headers: h, body: JSON.stringify({ tracking: { tracking_number: n } }) }); } catch (e) {}
      const r = await http(base + '?tracking_numbers=' + encodeURIComponent(n), { headers: h });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = parseJson(r.body); if (!j) throw new Error('ответ не JSON');
      const tr = j.data && j.data.trackings && j.data.trackings[0];
      if (!tr) throw new Error('нет данных — повторите позже');
      const ev = (tr.checkpoints || []).map((c) => ({ t: parseTime(c.checkpoint_time || c.created_at), text: c.message || c.subtag_message || c.tag || '', place: c.location || '' })).filter((e) => e.t && e.text);
      return ev;
    },
  },
];
const SERVICES = [
  ['17TRACK', 'https://t.17track.net/ru#nums={n}', '#2563eb', '17', 'Универсальный трекер, объединяет Китай и местные почты'],
  ['Cainiao', 'https://global.cainiao.com/newDetail.htm?mailNoList={n}', '#f97316', 'CN', 'Логистика AliExpress'],
  ['Казпочта', 'https://post.kz/mail/search/track/{n}', '#16a34a', 'KZ', 'Отслеживание внутри Казахстана'],
  ['MyPoint', 'https://mypoint.kz/tracking', '#f43f5e', 'MP', 'Казахстанский трекинг (номер скопируется — вставьте в поле)'],
  ['AfterShip', 'https://www.aftership.com/track/{n}', '#7c3aed', 'AS', 'Мировой агрегатор'],
  ['Parcels', 'https://parcelsapp.com/ru/tracking/{n}', '#0ea5e9', 'PA', 'Агрегатор: десятки служб сразу'],
  ['Track24', 'https://track24.ru/?code={n}', '#e11d48', 'T24', 'Русскоязычный агрегатор'],
  ['CDEK KZ', 'https://www.cdek.kz/ru/tracking?order_id={n}', '#22c55e', 'CD', 'Курьерская доставка по Казахстану'],
  ['AliExpress', 'https://track.aliexpress.com/logisticsdetail.htm?tradeId={n}', '#ef4444', 'Ali', 'Заказ AliExpress (нужен вход в аккаунт)'],
  ['Yanwen', 'https://track.yw56.com.cn/en/querydel?nums={n}', '#f59e0b', 'YW', 'Китайский перевозчик Yanwen'],
  ['4PX', 'https://track.4px.com/#/result/0/{n}', '#14b8a6', '4P', 'Китайский перевозчик 4PX'],
  ['YunExpress', 'https://www.yuntrack.com/Track/Detail/{n}', '#6366f1', 'YE', 'Китайский перевозчик YunExpress'],
];

/* ================= Скрытый браузер: автоматический опрос сайтов ================= */
const scrapes = {};
window.__scrape = (id, payload) => { const r = scrapes[id]; if (!r) return; delete scrapes[id]; r(payload); };
function scrape(url, n, form) {
  return new Promise((res) => {
    if (!(A && A.scrape)) { res(null); return; }
    const id = uid(); scrapes[id] = res;
    A.scrape(id, url, n, !!form);
    setTimeout(() => { if (scrapes[id]) { delete scrapes[id]; res(null); } }, 180000);
  });
}
const DRE = /(\d{1,2}[.\/]\d{1,2}[.\/]\d{4}|\d{4}-\d{2}-\d{2})(?:[ T,]+(\d{1,2}:\d{2}(?::\d{2})?))?/;
const TRE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const JUNK = /cookie|©|copyright|политик|privacy|конфиденц|подпис|войти|регистрац/i;
function parseTextEvents(text, n) {
  if (String(text).toUpperCase().indexOf(n) < 0) return [];
  const lines = String(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const now = Date.now();
  for (let i = 0; i < lines.length && out.length < 60; i++) {
    const m = lines[i].match(DRE); if (!m) continue;
    let time = m[2];
    const parts = [];
    const rest = (lines[i].slice(0, m.index) + ' ' + lines[i].slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    if (rest.length >= 4) parts.push(rest);
    let j = i + 1;
    if (!time && j < lines.length && TRE.test(lines[j])) { time = lines[j]; j++; }
    while (j < lines.length && parts.length < 2 && !DRE.test(lines[j]) && lines[j].length < 200) { parts.push(lines[j]); j++; }
    const t = parseTime(m[1] + ' ' + (time || '00:00'));
    const txt = parts.join(', ').trim();
    if (!t || t < Date.UTC(2020, 0, 1) || t > now + 3600000) continue;
    if (txt.length < 4 || JUNK.test(txt) || txt.toUpperCase() === n) continue;
    out.push({ t, text: txt, place: '' });
  }
  return out;
}
// [id, название, адрес ({n} — номер), заполнять форму, область]
const WEB = [
  ['w17', '17TRACK', 'https://t.17track.net/ru#nums={n}', false, 'all'],
  ['wparcels', 'Parcels', 'https://parcelsapp.com/ru/tracking/{n}', false, 'all'],
  ['waftership', 'AfterShip (сайт)', 'https://www.aftership.com/track/{n}', false, 'all'],
  ['wtrack24', 'Track24', 'https://track24.ru/?code={n}', false, 'all'],
  ['wmypoint', 'MyPoint', 'https://mypoint.kz/tracking', true, 'all'],
  ['wkazpost', 'Казпочта (сайт)', 'https://post.kz/mail/search/track/{n}', false, 'kz'],
  ['wcdek', 'CDEK KZ', 'https://www.cdek.kz/ru/tracking?order_id={n}', false, 'kz'],
  ['wcainiao', 'Cainiao (сайт)', 'https://global.cainiao.com/newDetail.htm?mailNoList={n}', false, 'cn'],
  ['wyanwen', 'Yanwen', 'https://track.yw56.com.cn/en/querydel?nums={n}', false, 'cn'],
  ['w4px', '4PX', 'https://track.4px.com/#/result/0/{n}', false, 'cn'],
  ['wyun', 'YunExpress', 'https://www.yuntrack.com/Track/Detail/{n}', false, 'cn'],
];
WEB.forEach(([id, name, tpl, form, scope]) => {
  PROVIDERS.push({
    id, name, web: true,
    applies: (d) => scope === 'all' || (scope === 'kz' ? (d.country === 'KZ' || d.country === '') : d.country !== 'KZ'),
    async run(n) {
      const g = await scrape(tpl.replace('{n}', encodeURIComponent(n)), n, form);
      if (!g) throw new Error('страница недоступна');
      let d; try { d = JSON.parse(g); } catch (e) { throw new Error('не удалось прочитать'); }
      let ev = [];
      (d.json || []).forEach((t) => { const j = parseJson(t); if (j) ev = ev.concat(genericEvents(j)); });
      if (!ev.length) ev = parseTextEvents(d.text || '', n);
      if (!ev.length) throw new Error(d.ok ? 'событий не найдено' : 'результата нет на странице');
      return ev;
    },
  });
});

/* ================= Обновление посылки ================= */
async function runProvider(prov, n) {
  try {
    let ev = await prov.run(n);
    ev = (ev || []).filter((e) => e && e.t && e.text);
    if (!ev.length) return { ok: false, msg: 'нет данных', ev: [] };
    return { ok: true, msg: ev.length + ' событ.', ev };
  } catch (e) {
    return { ok: false, msg: String(e.message || e).slice(0, 60), ev: [] };
  }
}
function mergeEvents(old, add) {
  const out = [];
  const key = (e) => e.text.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '').slice(0, 40);
  old.concat(add).sort((x, y) => y.t - x.t).forEach((e) => {
    const k = key(e);
    if (!out.some((o) => key(o) === k && Math.abs(o.t - e.t) <= 14 * 3600000)) out.push(e);
  });
  return out;
}
const hasTrack = (p) => p.numbers.some((x) => detect(x.n).kind === 'track');
async function refreshParcel(p) {
  if (p.busy) return 0;
  p.busy = true; p.sources = {};
  const jobs = [];
  p.numbers.forEach((num) => {
    const d = detect(num.n);
    if (d.kind !== 'track') return;
    PROVIDERS.forEach((prov) => {
      if (prov.key && !S.keys[prov.key]) return;
      if (prov.web && (!S.web || !(A && A.scrape))) return;
      if (prov.applies && !prov.applies(d)) return;
      jobs.push({ prov, num: num.n });
    });
  });
  p.prog = { done: 0, total: jobs.length };
  jobs.forEach((j) => { p.sources[j.prov.id + '|' + j.num] = { name: j.prov.name, num: j.num, ok: false, pending: true, msg: 'проверяю…' }; });
  render();
  const before = p.events.length;
  let all = p.events.slice();
  await Promise.all(jobs.map((j) => runProvider(j.prov, j.num).then((r) => {
    p.sources[j.prov.id + '|' + j.num] = { name: j.prov.name, num: j.num, ok: r.ok, msg: r.msg };
    if (r.ok) {
      all = mergeEvents(all, r.ev.map((e) => ({ t: e.t, text: ru(e.text), place: e.place, src: j.prov.name, num: j.num })));
      p.events = all; p.stage = calcStage(p);
    }
    p.prog.done++; save(); render();
  })));
  p.busy = false; p.prog = null;
  p.stage = calcStage(p); p.updated = Date.now();
  save(); render();
  return p.events.length - before;
}

/* ================= Форматирование ================= */
const pad = (n) => (n < 10 ? '0' : '') + n;
function fmt(t) { const d = new Date(t); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60); if (h < 24) return h + ' ч назад';
  return Math.round(h / 24) + ' дн. назад';
}

/* ================= Иконки ================= */
const I = {
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg>',
};

/* ================= Навигация ================= */
let R = { name: 'home' };
const TABS = ['home', 'services', 'settings'];
function go(name, params) {
  R = Object.assign({ name }, params || {}); closeSheet(); render(); $('#view').scrollTop = 0;
  if (name === 'detail') {
    const p = S.parcels.find((x) => x.id === R.id);
    if (p && !p.busy && p.stage !== 6 && hasTrack(p) && (!p.updated || Date.now() - p.updated > 10 * 60000)) setTimeout(() => doRefresh(p), 80);
  }
}
window.__back = function () {
  if (!$('#sheet').hidden) { closeSheet(); return true; }
  if (R.name === 'detail') { go('home'); return true; }
  if (R.name === 'themes' || R.name === 'fonts') { go('settings'); return true; }
  if (R.name !== 'home') { go('home'); return true; }
  return false;
};
function openSheet(html, mount) {
  const sh = $('#sheet'); sh.innerHTML = '<div class="panel">' + html + '</div>'; sh.hidden = false;
  sh.onclick = (e) => { if (e.target === sh) closeSheet(); };
  if (mount) mount(sh);
}
function closeSheet() { const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; }

/* ================= Рендер ================= */
function setTop(title, sub, back, right) {
  $('#top').innerHTML =
    (back ? '<button class="iconbtn" id="tb">' + I.back + '</button>' : '<img class="logo" src="logo.png" alt="">') +
    '<h1>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h1>' + (right || '');
  if (back) $('#tb').onclick = () => window.__back();
}
function renderNav() {
  const items = [['home', 'Посылки', I.box], ['services', 'Сервисы', I.globe], ['settings', 'Настройки', I.gear]];
  const cur = R.name === 'detail' ? 'home' : (R.name === 'themes' || R.name === 'fonts') ? 'settings' : R.name;
  $('#nav').innerHTML = items.map((i) => '<button data-g="' + i[0] + '" class="' + (cur === i[0] ? 'on' : '') + '">' + i[2] + '<span>' + i[1] + '</span></button>').join('');
  $('#nav').querySelectorAll('button').forEach((b) => (b.onclick = () => go(b.dataset.g)));
  $('#nav').style.display = (R.name === 'detail' || R.name === 'themes' || R.name === 'fonts') ? 'none' : 'flex';
}
function render() {
  const fn = { home: vHome, detail: vDetail, services: vServices, settings: vSettings, themes: vThemes, fonts: vFonts }[R.name] || vHome;
  const y = $('#view').scrollTop;
  const key = R.name + (R.id || '');
  const same = render.last === key;
  render.last = key;
  fn();
  renderNav();
  if (same || R.keep) { $('#view').scrollTop = y; }
  const fab = document.getElementById('fab');
  if (fab) fab.remove();
  if (R.name === 'home') {
    const b = document.createElement('button'); b.id = 'fab'; b.className = 'fab'; b.textContent = '+'; b.onclick = addSheet;
    $('#app').appendChild(b);
  }
}

function stageBar(st) {
  return '<div class="stages">' + STAGES.map((n, i) => '<div class="stage ' + (i <= st ? 'done ' : '') + (i === st ? 'cur' : '') + '"><b>' + (i <= st ? '✓' : i + 1) + '</b>' + esc(n) + '</div>').join('') + '</div>';
}

function vHome() {
  const act = S.parcels.filter((p) => p.stage !== 6).length;
  setTop('Rin-pochta', S.parcels.length ? 'В пути: ' + act + ' · всего: ' + S.parcels.length : 'Китай → Казахстан в одном приложении',
    false, S.parcels.length ? '<button class="iconbtn" id="ra">' + I.refresh + '</button>' : '');
  const ra = $('#ra'); if (ra) ra.onclick = refreshAll;
  const v = $('#view');
  if (!S.parcels.length) {
    v.innerHTML = '<div class="empty"><img src="logo.png" alt=""><h3>Пока нет посылок</h3>Нажмите «+» и введите трек-номер или номер заказа Pinduoduo / AliExpress.<br>Китайский и казахстанский номера можно объединить в одну посылку.</div>';
    return;
  }
  v.innerHTML = S.parcels.map((p) => {
    const last = p.events[0];
    const st = p.stage == null ? -1 : p.stage;
    const first = p.numbers[0];
    return '<div class="card tap" data-id="' + p.id + '"><div class="row"><div class="grow"><div class="title">' + esc(p.title || first.n) + '</div><div class="num">' +
      p.numbers.map((x) => esc(x.n)).join(' → ') + '</div></div>' +
      (p.busy ? '<span class="chip"><span class="spin"></span> ' + (p.prog ? p.prog.done + '/' + p.prog.total : '') + '</span>' : '<span class="chip ' + (st === 6 ? 'ok' : st >= 0 ? 'acc' : '') + '">' + (st >= 0 ? esc(STAGE_FULL[st]) : 'Ждём данные') + '</span>') + '</div>' +
      (last ? '<div class="last">' + esc(last.text) + '</div><div class="muted" style="margin-top:4px">' + fmt(last.t) + (last.place ? ' · ' + esc(last.place) : '') + '</div>' :
        '<div class="muted" style="margin-top:8px">' + (detect(first.n).kind === 'track' ? 'Событий пока нет. Потяните «обновить».' : esc(detect(first.n).label) + ' — добавьте трек-номер посылки') + '</div>') +
      '<div class="bar"><i style="width:' + ((st + 1) / 7 * 100) + '%"></i></div></div>';
  }).join('');
  v.querySelectorAll('.card').forEach((c) => (c.onclick = () => go('detail', { id: c.dataset.id })));
}

function vDetail() {
  const p = S.parcels.find((x) => x.id === R.id);
  if (!p) { go('home'); return; }
  setTop(p.title || p.numbers[0].n, p.updated ? 'Обновлено ' + ago(p.updated) : 'Ещё не обновлялось', true,
    '<button class="iconbtn" id="rf">' + (p.busy ? '<span class="spin"></span>' : I.refresh) + '</button>');
  $('#rf').onclick = () => doRefresh(p);
  const st = p.stage == null ? -1 : p.stage;
  const v = $('#view');
  let h = '<div class="card"><div class="row"><div class="grow"><div class="muted">Статус</div><div class="title" style="font-size:18px;white-space:normal">' +
    (st >= 0 ? esc(STAGE_FULL[st]) : 'Ожидаем данные') + '</div></div></div>' + stageBar(st) +
    '<div class="bar"><i style="width:' + ((st + 1) / 7 * 100) + '%"></i></div></div>';

  if (p.busy && p.prog) h += '<div class="card"><div class="row"><span class="spin"></span><div class="grow"><b>Проверяю источники</b> <span class="muted">' + p.prog.done + ' из ' + p.prog.total + '</span></div></div><div class="bar"><i style="width:' + (p.prog.total ? p.prog.done / p.prog.total * 100 : 0) + '%"></i></div></div>';
  h += '<h2>Номера посылки</h2><div class="card">' + p.numbers.map((x, i) => {
    const d = detect(x.n);
    return '<div class="row" style="padding:6px 0"><div class="grow"><div class="title">' + esc(x.n) + '</div><div class="muted">' + esc(d.label) + '</div></div>' +
      '<button class="btn ghost sm" data-copy="' + esc(x.n) + '">Копировать</button>' +
      (p.numbers.length > 1 ? '<button class="btn danger sm" data-rm="' + i + '">✕</button>' : '') + '</div>';
  }).join('') + '<div class="btns"><button class="btn sm" id="addn">+ Добавить номер (Китай / Казахстан)</button><button class="btn ghost sm" id="ren">Переименовать</button></div></div>';

  p.numbers.forEach((x) => {
    const d = detect(x.n);
    if (d.kind === 'ali') {
      h += '<div class="card"><div class="hint"><b>Это номер заказа AliExpress.</b> Трек-номер посылки (LP…, AE… или номер почты) виден в приложении AliExpress: Заказы → Отследить. Скопируйте его и добавьте сюда кнопкой «+ Добавить номер» — тогда маршрут подтянется автоматически.</div><div class="btns"><button class="btn sm" data-open="ali" data-n="' + esc(x.n) + '">Открыть заказ</button><button class="btn ghost sm" data-app="com.alibaba.aliexpresshd">Приложение AliExpress</button></div></div>';
    } else if (d.kind === 'pdd') {
      h += '<div class="card"><div class="hint"><b>Это номер заказа Pinduoduo.</b> Pinduoduo не отдаёт данные посылки вне своего приложения. Откройте заказ в Pinduoduo → «Логистика» и скопируйте номер отправления (YT…, SF…, JT… и т.п.), затем добавьте его кнопкой «+ Добавить номер».</div><div class="btns"><button class="btn sm" data-app="com.xunmeng.pinduoduo">Открыть Pinduoduo</button></div></div>';
    }
  });

  const srcs = Object.values(p.sources || {});
  if (srcs.length) {
    h += '<h2>Источники</h2><div class="card">' + srcs.map((s) => '<div class="row" style="padding:4px 0"><div class="grow">' + esc(s.name) + (p.numbers.length > 1 ? ' <span class="muted">' + esc(s.num.slice(0, 6)) + '…</span>' : '') + '</div>' + (s.pending ? '<span class="chip"><span class="spin"></span> проверяю</span>' : '<span class="chip ' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? '✓ ' : '✕ ') + esc(s.msg) + '</span>') + '</div>').join('') +
      '<div class="hint" style="margin-top:8px">Если источники не отвечают — проверьте номер на сайтах кнопкой ниже или добавьте API-ключ в настройках.</div></div>';
  }

  const srcNames = Array.from(new Set(p.events.map((e) => e.src)));
  if (R.sf && !srcNames.includes(R.sf)) R.sf = null;
  const evs = R.sf ? p.events.filter((e) => e.src === R.sf) : p.events;
  h += '<h2>Маршрут</h2>';
  if (srcNames.length > 1) h += '<div class="btns" style="margin:0 0 10px"><button class="chip ' + (!R.sf ? 'acc' : '') + '" data-sf="">Все · ' + p.events.length + '</button>' + srcNames.map((n) => '<button class="chip ' + (R.sf === n ? 'acc' : '') + '" data-sf="' + esc(n) + '">' + esc(n) + ' · ' + p.events.filter((e) => e.src === n).length + '</button>').join('') + '</div>';
  if (p.events.length) {
    h += '<div class="card"><div class="tl">' + evs.map((e) => '<div class="ev"><div class="t">' + fmt(e.t) + '</div><div class="x">' + esc(e.text) + '</div>' + (e.place ? '<div class="p">' + esc(e.place) + '</div>' : '') + '<span class="s">' + esc(e.src) + '</span></div>').join('') + '</div></div>';
  } else {
    h += '<div class="card"><div class="hint">Данных пока нет. Новые посылки появляются в системах через несколько часов после отправки. Нажмите «обновить» позже или откройте номер на сайтах сервисов.</div></div>';
  }
  h += '<div class="btns"><button class="btn" id="chk">Открыть вручную</button><button class="btn ghost" id="shr">Поделиться</button><button class="btn danger" id="del">Удалить</button></div>';
  v.innerHTML = h;

  v.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => { if (A) A.copy(b.dataset.copy); toast('Номер скопирован'); }));
  v.querySelectorAll('[data-sf]').forEach((b) => (b.onclick = () => { R.sf = b.dataset.sf || null; render(); }));
  v.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { p.numbers.splice(+b.dataset.rm, 1); p.events = []; save(); doRefresh(p); }));
  v.querySelectorAll('[data-open="ali"]').forEach((b) => (b.onclick = () => openUrl('AliExpress', SERVICES.find((x) => x[0] === 'AliExpress')[1].replace('{n}', encodeURIComponent(b.dataset.n)))));
  v.querySelectorAll('[data-app]').forEach((b) => (b.onclick = () => { if (!(A && A.openApp && A.openApp(b.dataset.app))) toast('Приложение не установлено'); }));
  $('#addn').onclick = () => addNumberSheet(p);
  $('#ren').onclick = () => renameSheet(p);
  $('#chk').onclick = () => checkSheet(p);
  $('#shr').onclick = () => {
    const txt = (p.title || '') + '\n' + p.numbers.map((x) => x.n).join(' → ') + '\n' + (p.stage >= 0 ? STAGE_FULL[p.stage] : '') + (p.events[0] ? '\n' + fmt(p.events[0].t) + ' ' + p.events[0].text : '');
    if (A) A.share(txt); else toast('Недоступно');
  };
  $('#del').onclick = () => openSheet('<h3>Удалить посылку?</h3><p class="muted">Все данные о ней будут стёрты.</p><div class="btns"><button class="btn danger block" id="y">Удалить</button><button class="btn ghost block" id="n">Отмена</button></div>', () => {
    $('#y').onclick = () => { S.parcels = S.parcels.filter((x) => x.id !== p.id); save(); go('home'); };
    $('#n').onclick = closeSheet;
  });
}

function openUrl(title, url) { if (A && A.openIn) A.openIn(title, url); else window.open(url, '_blank'); }

function checkSheet(p) {
  const nums = p.numbers.filter((x) => detect(x.n).kind !== 'pdd');
  let h = '<h3>Проверить на сайтах</h3><div class="muted">Откроется внутри приложения</div>';
  nums.forEach((x, i) => {
    h += '<label class="l">' + esc(x.n) + '</label><div class="btns" style="margin-top:0">' + SERVICES.map((s, j) => '<button class="btn ghost sm" data-i="' + i + '" data-j="' + j + '">' + esc(s[0]) + '</button>').join('') + '</div>';
  });
  openSheet(h, (sh) => sh.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => {
    const s = SERVICES[+b.dataset.j]; const nn = nums[+b.dataset.i].n; closeSheet(); if (s[1].indexOf('{n}') < 0 && A) { A.copy(nn); toast('Номер скопирован — вставьте в поле'); } openUrl(s[0], s[1].replace('{n}', encodeURIComponent(nn)));
  })));
}

function vServices() {
  setTop('Сервисы', 'Проверка трека на сайтах и в приложениях');
  const v = $('#view');
  v.innerHTML = '<div class="card"><label class="l" style="margin-top:0">Номер для проверки</label><input type="text" id="sn" placeholder="Трек-номер или номер заказа" autocomplete="off"><div class="btns"><button class="btn ghost sm" id="sp">Вставить</button></div></div>' +
    '<h2>Приложения магазинов</h2><div class="card"><div class="btns" style="margin-top:0"><button class="btn sm" data-app="com.xunmeng.pinduoduo">Pinduoduo</button><button class="btn sm" data-app="com.alibaba.aliexpresshd">AliExpress</button></div></div>' +
    '<h2>Трекинг-сервисы</h2>' + SERVICES.map((s, i) => '<div class="card tap svc" data-i="' + i + '"><div class="dot" style="background:' + s[2] + '">' + esc(s[3]) + '</div><div class="grow"><div class="title">' + esc(s[0]) + '</div><div class="muted">' + esc(s[4]) + '</div></div><span class="muted">›</span></div>').join('');
  $('#sp').onclick = () => { if (A) { $('#sn').value = A.paste().trim(); } };
  v.querySelectorAll('.svc').forEach((c) => (c.onclick = () => {
    const n = norm($('#sn').value); if (!n) { toast('Введите номер'); return; }
    const s = SERVICES[+c.dataset.i]; if (s[1].indexOf('{n}') < 0 && A) { A.copy(n); toast('Номер скопирован — вставьте в поле'); } openUrl(s[0], s[1].replace('{n}', encodeURIComponent(n)));
  }));
  v.querySelectorAll('[data-app]').forEach((b) => (b.onclick = () => { if (!(A && A.openApp && A.openApp(b.dataset.app))) toast('Приложение не установлено'); }));
}

function vSettings() {
  setTop('Настройки', 'Оформление и источники данных');
  const t = THEMES[S.theme] || THEMES[0];
  const v = $('#view');
  v.innerHTML = '<h2>Оформление</h2>' +
    '<div class="card tap row" id="gt"><div class="sw" style="width:46px;height:46px;aspect-ratio:auto;background:linear-gradient(160deg,' + t[2].join(',') + ')"><i style="background:' + t[3] + '"></i></div><div class="grow"><div class="title">Тема: ' + esc(t[0]) + '</div><div class="muted">40 тем · ' + (t[1] === 'dark' ? 'тёмная' : 'светлая') + '</div></div><span class="muted">›</span></div>' +
    '<div class="card tap row" id="gf"><div class="grow"><div class="title" style="font-size:20px">Шрифт: ' + esc(S.font) + '</div><div class="muted">40 русских шрифтов</div></div><span class="muted">›</span></div>' +
    '<h2>Автопроверка</h2><div class="card"><div class="row"><div class="grow"><div class="title">Опрос сайтов автоматически</div><div class="muted">Скрытый браузер сам открывает 11 сервисов, включая MyPoint, и забирает маршрут</div></div><button class="btn sm ' + (S.web ? '' : 'ghost') + '" id="wb">' + (S.web ? 'Вкл' : 'Выкл') + '</button></div></div>' +
    '<h2>Ключи API (необязательно)</h2><div class="card"><div class="hint">С ключами подключаются сервисы <b>17TRACK</b> и <b>AfterShip</b> — данные становятся полнее и достовернее. Ключ хранится только на вашем телефоне.</div>' +
    '<label class="l">17TRACK API-ключ (api.17track.net)</label><input type="password" id="k1" value="' + esc(S.keys.t17) + '" placeholder="не задан" autocomplete="off">' +
    '<label class="l">AfterShip API-ключ (aftership.com)</label><input type="password" id="k2" value="' + esc(S.keys.aftership) + '" placeholder="не задан" autocomplete="off"></div>' +
    '<h2>Данные</h2><div class="card"><button class="btn danger block" id="clr">Удалить все посылки</button></div>' +
    '<div class="muted" style="text-align:center;margin-top:14px">Rin-pochta ' + '1.0 · Китай → Казахстан</div>';
  $('#wb').onclick = () => { S.web = !S.web; save(); R.keep = true; render(); R.keep = false; };
  $('#gt').onclick = () => go('themes'); $('#gf').onclick = () => go('fonts');
  $('#k1').onchange = (e) => { S.keys.t17 = e.target.value.trim(); save(); toast('Ключ сохранён'); };
  $('#k2').onchange = (e) => { S.keys.aftership = e.target.value.trim(); save(); toast('Ключ сохранён'); };
  $('#clr').onclick = () => openSheet('<h3>Удалить все посылки?</h3><div class="btns"><button class="btn danger block" id="y">Удалить</button><button class="btn ghost block" id="n">Отмена</button></div>', () => {
    $('#y').onclick = () => { S.parcels = []; save(); go('home'); }; $('#n').onclick = closeSheet;
  });
}

function vThemes() {
  setTop('Темы', '20 тёмных · 20 светлых', true);
  const grid = (mode, title) => '<h2>' + title + '</h2><div class="tgrid">' + THEMES.map((t, i) => t[1] === mode ?
    '<div><div class="sw ' + (i === S.theme ? 'on' : '') + '" data-i="' + i + '" style="background:linear-gradient(160deg,' + t[2].join(',') + ')"><i style="background:linear-gradient(135deg,' + t[3] + ',' + (t[4] || t[3]) + ')"></i></div><div class="swname">' + esc(t[0]) + '</div></div>' : '').join('') + '</div>';
  const v = $('#view');
  v.innerHTML = grid('dark', 'Тёмные') + grid('light', 'Светлые');
  v.querySelectorAll('.sw').forEach((s) => (s.onclick = () => { S.theme = +s.dataset.i; save(); applyTheme(); R.keep = true; render(); R.keep = false; }));
}

function vFonts() {
  setTop('Шрифты', '40 шрифтов с кириллицей', true);
  loadGoogleFonts(FONTS.map((f) => f[0]), 'all');
  const v = $('#view');
  v.innerHTML = FONTS.map((f, i) => '<div class="fitem ' + (f[0] === S.font ? 'on' : '') + '" data-i="' + i + '"><div class="fn">' + esc(f[0]) + '</div><div class="fs" style="font-family:\'' + f[0] + '\',' + (f[1] === 'monospace' ? 'monospace' : f[1] === 'serif' ? 'serif' : 'sans-serif') + '">Посылка Алматы 12345</div></div>').join('');
  v.querySelectorAll('.fitem').forEach((el) => (el.onclick = () => { S.font = FONTS[+el.dataset.i][0]; save(); applyFont(); R.keep = true; render(); R.keep = false; }));
}

/* ================= Листы ================= */
function addSheet() {
  openSheet('<h3>Новая посылка</h3><div class="muted">Трек-номер или номер заказа Pinduoduo / AliExpress</div>' +
    '<label class="l">Номер</label><input type="text" id="an" placeholder="LP00123456789012 / RR123456789KZ" autocomplete="off" autocapitalize="characters">' +
    '<div class="muted" id="ad" style="margin:6px 4px 0;min-height:18px"></div>' +
    '<label class="l">Название (необязательно)</label><input type="text" id="at" placeholder="Например: Чехол для телефона" autocomplete="off">' +
    '<div class="btns"><button class="btn block" id="ok">Добавить и отследить</button><button class="btn ghost block" id="pp">Вставить из буфера</button></div>',
    () => {
      const inp = $('#an'); setTimeout(() => inp.focus(), 150);
      const upd = () => { const n = norm(inp.value); $('#ad').textContent = n ? 'Определено: ' + detect(n).label : ''; };
      inp.oninput = upd;
      $('#pp').onclick = () => { if (A) { inp.value = A.paste().trim(); upd(); } };
      $('#ok').onclick = () => {
        const n = norm(inp.value); if (n.length < 6) { toast('Введите номер полностью'); return; }
        const ex = S.parcels.find((p) => p.numbers.some((x) => x.n === n));
        if (ex) { go('detail', { id: ex.id }); toast('Такая посылка уже есть'); return; }
        const p = { id: uid(), title: $('#at').value.trim(), numbers: [{ n }], events: [], sources: {}, created: Date.now(), stage: -1 };
        S.parcels.unshift(p); save(); go('detail', { id: p.id });
      };
    });
}
function addNumberSheet(p) {
  openSheet('<h3>Добавить номер</h3><div class="muted">Например, казахстанский трек к китайскому — маршрут объединится в одну ленту</div>' +
    '<label class="l">Номер</label><input type="text" id="an" placeholder="RR123456789KZ" autocomplete="off" autocapitalize="characters">' +
    '<div class="muted" id="ad" style="margin:6px 4px 0;min-height:18px"></div>' +
    '<div class="btns"><button class="btn block" id="ok">Добавить</button><button class="btn ghost block" id="pp">Вставить из буфера</button></div>',
    () => {
      const inp = $('#an'); setTimeout(() => inp.focus(), 150);
      inp.oninput = () => { const n = norm(inp.value); $('#ad').textContent = n ? 'Определено: ' + detect(n).label : ''; };
      $('#pp').onclick = () => { if (A) { inp.value = A.paste().trim(); inp.oninput(); } };
      $('#ok').onclick = () => {
        const n = norm(inp.value); if (n.length < 6) { toast('Введите номер полностью'); return; }
        if (p.numbers.some((x) => x.n === n)) { toast('Этот номер уже добавлен'); return; }
        p.numbers.push({ n }); save(); closeSheet(); doRefresh(p);
      };
    });
}
function renameSheet(p) {
  openSheet('<h3>Название посылки</h3><label class="l">Название</label><input type="text" id="rt" value="' + esc(p.title || '') + '" autocomplete="off"><div class="btns"><button class="btn block" id="ok">Сохранить</button></div>', () => {
    $('#ok').onclick = () => { p.title = $('#rt').value.trim(); save(); closeSheet(); render(); };
  });
}

/* ================= Обновление ================= */
async function doRefresh(p) {
  if (p.busy) { toast('Проверка уже идёт'); return; }
  const d = await refreshParcel(p);
  if (!p.events.length) {
    const hasTrack = p.numbers.some((x) => detect(x.n).kind === 'track');
    toast(hasTrack ? 'Данных пока нет — попробуйте позже' : 'Добавьте трек-номер посылки');
  } else if (d > 0) toast('Новых событий: ' + d);
  else toast('Без изменений');
}
async function refreshAll() {
  const list = S.parcels.filter((p) => p.stage !== 6 && p.numbers.some((x) => detect(x.n).kind === 'track'));
  if (!list.length) { toast('Нечего обновлять'); return; }
  toast('Обновляю ' + list.length + '…');
  for (const p of list) { try { await refreshParcel(p); } catch (e) {} }
  toast('Готово');
}

/* ================= Старт ================= */
S.parcels.forEach((p) => { p.busy = false; p.prog = null; });
applyTheme(); applyFont(); render();
setTimeout(() => {
  S.parcels.filter((p) => p.stage !== 6 && (!p.updated || Date.now() - p.updated > 30 * 60000) && p.numbers.some((x) => detect(x.n).kind === 'track'))
    .reduce((pr, p) => pr.then(() => refreshParcel(p).catch(() => {})), Promise.resolve());
}, 800);
window.__rp = { parseTextEvents, mergeEvents, S, detect, classify, genericEvents, parseTime, calcStage, refreshParcel, go };
})();

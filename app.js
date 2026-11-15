/* نظام المبيعات الهاتفية والعمولات — العز للعود
   تصميم وتطوير: أحمد سيد — مدير النمو
   Static page + Supabase. Every permission is enforced by the database (RLS + RPCs); this file only hides what a role cannot use. */
(function () {
  'use strict';
  var CFG = window.PS_CONFIG || {};
  var TZ = 'Asia/Riyadh';
  var MONTHS = ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01'];
  var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  var L = {
    role: { pending: 'بانتظار التفعيل', manager: 'مدير النظام', data_entry: 'مشرف إدخال', sales_rep: 'مندوب مبيعات', viewer: 'اطلاع فقط', finance: 'المالية', ceo: 'المدير التنفيذي' },
    basis: { both: 'كود + موظف سلة (متطابقان)', code: 'بالكود فقط', employee: 'بموظف سلة فقط', conflict: 'تعارض', none: 'غير منسوب', manual: 'قرار يدوي' },
    reason: {
      channel_rule: 'قناة بيع خاضعة للمراجعة', unknown_status: 'حالة غير معرّفة', conflict: 'تعارض بين الكود وموظف سلة',
      missing_delivery_date: 'تاريخ التوصيل مفقود', partial_value_missing: 'قيمة المرتجع الجزئي مفقودة',
      inactive_owner: 'صاحب الكود غير مفعّل أو غير مؤكد', early_return: 'مرتجع مبكر بعد التوصيل',
      outlier_value: 'قيمة شاذة عن معتاد الموظف', repeat_customer: 'عميل متكرر على نفس الكود'
    },
    treat: { delivered: 'تم التوصيل', return_full: 'مرتجع كامل', return_partial: 'مرتجع جزئي', pending: 'قيد المعالجة', ignore: 'يُتجاهل' },
    review: { none: '—', open: 'بحاجة مراجعة', approved: 'معتمد', excluded: 'مستبعد' },
    run: { live: 'مباشر (لم يُولَّد كشف)', draft: 'مسودة', finance_approved: 'اعتمدته المالية', locked: 'مقفول' },
    plan: { draft: 'مسودة', pending_ceo: 'بانتظار المدير التنفيذي', approved: 'معتمدة', rejected: 'مرفوضة' },
    src: { manual: 'يدوي', import: 'Excel', sync: 'سلة' },
    method: { marginal: 'تصاعدي بالشريحة', tier_on_all: 'الشريحة على كامل المبلغ' },
    over: { stacked: 'تراكمي (الشريحة العليا + الإضافة)', flat_1: 'إضافة ثابتة على الزيادة' },
    scen: { '5M': '5 مليون', '6M': '6 مليون', custom: 'مخصص' },
    dec: { approve: 'اعتماد', reject: 'رفض', request: 'طلب' }
  };

  if (window.Chart) { Chart.defaults.locale = 'en-US'; Chart.defaults.font.family = '"Segoe UI",Tahoma,"Noto Sans Arabic","Geeza Pro",Arial,sans-serif'; }
  var S = { sb: null, user: null, profile: null, role: 'none', month: MONTHS[0], emps: [], empById: {}, view: 'dash', sub: 'targets', charts: [], reviewCount: 0, rulesConfirmed: null, statuses: [], names: {}, ordersPage: 0, orderRows: [] };

  /* ---------- helpers ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, d) { if (n == null || n === '') return '—'; var x = Number(n); if (!isFinite(x)) return '—'; return x.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d }); }
  function money(n) { return n == null ? '—' : num(n, 2); }
  function pct(x) { return x == null ? '—' : (Number(x) * 100).toFixed(1) + '%'; }
  function fmtParts(iso, withTime) {
    var o = { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }; if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; o.hour12 = false; }
    var p = {}; new Intl.DateTimeFormat('en-GB', o).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return '\u2066' + p.year + '-' + p.month + '-' + p.day + (withTime ? ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute : '') + '\u2069';
  }
  function fmtDT(iso) { return iso ? fmtParts(iso, true) : '—'; }
  function fmtD(iso) { return iso ? fmtParts(iso, false) : '—'; }
  function monthLabel(m) { var p = m.split('-'); return AR_MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }
  function nextMonth(m) { var p = m.split('-').map(Number); var y = p[0], mo = p[1] + 1; if (mo > 12) { mo = 1; y++; } return y + '-' + String(mo).padStart(2, '0') + '-01'; }
  function riyadhStart(m) { return m + 'T00:00:00+03:00'; }
  function todayRiyadh() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
  function toast(msg, kind) { var t = $('#toast'); t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, kind === 'bad' ? 6500 : 3200); }
  function errText(e) { var m = (e && e.message) || String(e); if (/permission denied|row-level security|violates/i.test(m)) return 'غير مصرح لك بهذا الإجراء'; if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال — تحقق من الإنترنت'; return m; }
  function fail(e) { console.error(e); toast(errText(e), 'bad'); }
  function can(what) {
    var r = S.role;
    return ({
      manage: r === 'manager', enter: r === 'manager' || r === 'data_entry', decide: r === 'manager' || r === 'finance',
      finance: r === 'finance', ceo: r === 'ceo', staff: r !== 'sales_rep' && r !== 'pending' && r !== 'none', audit: r === 'manager' || r === 'ceo' || r === 'finance'
    })[what];
  }
  async function rpc(name, args) { var res = await S.sb.rpc(name, args || {}); if (res.error) throw res.error; return res.data; }
  async function sel(p) { var res = await p; if (res.error) throw res.error; return res.data; }
  function destroyCharts() { S.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* ignore */ } }); S.charts = []; }
  function tag(txt, kind) { return '<span class="tag ' + (kind || '') + '">' + esc(txt) + '</span>'; }
  function empName(id) { return id && S.empById[id] ? S.empById[id].name : '—'; }
  function userName(id) { return id ? (S.names[id] || 'مستخدم') : '—'; }
  function empty(msg) { return '<div class="empty">' + esc(msg) + '</div>'; }
  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return empty(opts.empty || 'لا توجد بيانات');
    var h = '<div class="tscroll"><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.num ? 'num' : '') + '">' + esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr' + (opts.rowAttr ? ' ' + opts.rowAttr(r) : '') + '>' + cols.map(function (c) {
        var v = c.f(r); return '<td class="' + (c.num ? 'num ' : '') + (c.wrap ? 'wrap' : '') + '">' + (c.raw ? v : esc(v)) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function exportXlsx(name, rows) {
    if (!rows.length) { toast('لا توجد بيانات للتصدير', 'bad'); return; }
    var ws = XLSX.utils.json_to_sheet(rows); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, name + '.xlsx');
  }
  function tierColor(a) { if (a == null) return '#bbb'; if (a >= 1) return '#b8923a'; if (a >= 0.9) return '#2f7d4f'; if (a >= 0.7) return '#2c5d8f'; if (a >= 0.5) return '#b7791f'; return '#9a9189'; }

  /* ---------- dialog ---------- */
  function openDlg(title, html) { $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = html; $('#dlg').hidden = false; var f = $('#dlgBody input,#dlgBody select,#dlgBody textarea'); if (f) f.focus(); }
  function closeDlg() { $('#dlg').hidden = true; $('#dlgBody').innerHTML = ''; }

  /* ---------- auth ---------- */
  function toEmail(u) { u = u.trim(); if (u.indexOf('@') > -1) return u; return u.toLowerCase() + '@users.alezz-oud.com'; }
  function showOnly(id) { ['boot', 'auth', 'wait', 'app'].forEach(function (x) { $('#' + x).hidden = x !== id; }); }
  function showAuth() { showOnly('auth'); }
  async function boot() {
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.indexOf('__') === 0) { $('#boot').textContent = 'الإعدادات غير مكتملة (config.js).'; return; }
    S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    S.sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') { S.profile = null; showAuth(); } });
    var m = null; try { m = localStorage.getItem('ps_month'); } catch (e) { /* storage blocked */ }
    var t = todayRiyadh().slice(0, 7) + '-01';
    S.month = MONTHS.indexOf(m) > -1 ? m : (MONTHS.indexOf(t) > -1 ? t : MONTHS[0]);
    var r = await S.sb.auth.getSession();
    if (r.data && r.data.session) await enter(r.data.session.user); else showAuth();
  }
  async function enter(user) {
    S.user = user;
    var p = await S.sb.from('ps_profiles').select('*').eq('id', user.id).maybeSingle();
    if (p.error) { fail(p.error); showAuth(); return; }
    S.profile = p.data; S.role = p.data && p.data.is_active ? p.data.role : 'pending';
    if (!p.data || S.role === 'pending') { showOnly('wait'); return; }
    var emps = await S.sb.from('ps_employees').select('*').order('name');
    S.emps = emps.data || []; S.empById = {}; S.emps.forEach(function (e) { S.empById[e.id] = e; });
    var pr = await S.sb.from('ps_profiles').select('id,full_name,username');
    S.names = {}; (pr.data || []).forEach(function (x) { S.names[x.id] = x.full_name || x.username; });
    S.names[user.id] = S.profile.full_name || S.profile.username;
    var st = await S.sb.from('ps_status_map').select('*').order('salla_status_name'); S.statuses = st.data || [];
    await refreshFlags();
    var me = S.empById[S.profile.employee_id];
    $('#userChip').textContent = (S.profile.full_name || S.profile.username) + ' — ' + L.role[S.role] + (me && S.role === 'sales_rep' ? ' (' + me.name + ')' : '');
    var sel = $('#monthSel'); sel.innerHTML = MONTHS.map(function (m) { return '<option value="' + m + '"' + (m === S.month ? ' selected' : '') + '>' + monthLabel(m) + '</option>'; }).join('');
    showOnly('app'); buildNav(); route();
  }
  async function refreshFlags() {
    if (can('staff')) {
      var c = await S.sb.from('ps_orders').select('id', { count: 'exact', head: true }).eq('review_status', 'open'); S.reviewCount = c.count || 0;
      var s = await S.sb.from('ps_settings').select('value').eq('key', 'rules_confirmed').maybeSingle();
      S.rulesConfirmed = s.data ? s.data.value === true : false;
    }
    var b = '';
    if (can('staff')) b += '<div class="bn info">نموذج أولي قيد التطوير — البيانات والعمولات هنا للمراجعة ولا تُصرف.</div>';
    if (can('staff') && S.rulesConfirmed !== true) b += '<div class="bn warn">قواعد العمولة الحالية مبدئية (إبلاغ شفهي من المدير التنفيذي). لا قفل نهائي ولا صرف قبل التأكيد الكتابي.</div>';
    $('#banner').innerHTML = b;
    var nb = $('#nav [data-v="review"] .bdg'); if (nb) nb.textContent = S.reviewCount; if (nb) nb.hidden = !S.reviewCount;
  }
  function buildNav() {
    var items = [['dash', 'لوحة المتابعة', true], ['orders', 'الطلبات', true], ['review', 'المراجعة', can('staff')], ['comm', 'العمولات والاعتماد', true], ['daily', 'التسجيل اليومي', true], ['import', 'استيراد Excel', can('enter')], ['settings', 'الأهداف والإعدادات', can('staff')]];
    $('#nav').innerHTML = items.filter(function (i) { return i[2]; }).map(function (i) {
      return '<button type="button" data-v="' + i[0] + '">' + i[1] + (i[0] === 'review' ? '<span class="bdg"' + (S.reviewCount ? '' : ' hidden') + '>' + S.reviewCount + '</span>' : '') + '</button>';
    }).join('');
  }
  function route() {
    var h = (location.hash || '').replace('#', ''); var valid = $$('#nav button').map(function (b) { return b.dataset.v; });
    S.view = valid.indexOf(h) > -1 ? h : 'dash';
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.view); });
    render();
  }
  async function render() {
    destroyCharts(); var v = $('#view'); v.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      var fn = { dash: vDash, orders: vOrders, review: vReview, comm: vComm, daily: vDaily, import: vImport, settings: vSettings }[S.view];
      await fn(v);
    } catch (e) { fail(e); v.innerHTML = empty('تعذّر تحميل هذه الصفحة: ' + errText(e)); }
  }

  /* ---------- dashboard ---------- */
  async function vDash(v) {
    var m = S.month;
    var res = await Promise.all([rpc('ps_statement', { p_month: m }), rpc('ps_leaderboard', { p_month: m }), rpc('ps_daily_series', { p_month: m })]);
    var st = res[0] || [], lb = res[1] || [], ser = res[2] || [];
    var tot = st.reduce(function (a, r) { a.val += Number(r.eligible_value || 0); a.tgt += Number(r.target || 0); a.comm += Number(r.commission || 0); a.n += Number(r.orders_count || 0); return a; }, { val: 0, tgt: 0, comm: 0, n: 0 });
    var ach = tot.tgt > 0 ? tot.val / tot.tgt : null;
    var status = st.length ? st[0].status : 'live'; var locked = st.length && st[0].locked;
    var h = '<h2>لوحة المتابعة — ' + monthLabel(m) + ' ' + tag(L.run[status] || status, locked ? 'ok' : 'warn') + '</h2>';
    h += '<div class="cards">' +
      '<div class="card"><div class="k">المحقَّق (طلبات مُسلَّمة مؤهلة)</div><div class="v">' + money(tot.val) + '</div><div class="s">' + num(tot.n) + ' طلب</div></div>' +
      '<div class="card"><div class="k">المستهدف</div><div class="v">' + (tot.tgt ? money(tot.tgt) : '—') + '</div><div class="s">' + (tot.tgt ? '' : 'لا توجد خطة معتمدة لهذا الشهر') + '</div></div>' +
      '<div class="card"><div class="k">نسبة التحقيق</div><div class="v">' + pct(ach) + '</div><div class="s">' + (ach == null ? '' : '<div class="bar"><i style="width:' + Math.min(100, ach * 100) + '%;background:' + tierColor(ach) + '"></i></div>') + '</div></div>' +
      (can('staff') ? '<div class="card"><div class="k">العمولة التقديرية</div><div class="v">' + money(tot.comm) + '</div><div class="s">' + (locked ? 'نهائية' : 'غير نهائية — تتغير مع المرتجعات') + '</div></div>' : '') +
      (can('staff') ? '<div class="card"><div class="k">بحاجة مراجعة</div><div class="v">' + num(S.reviewCount) + '</div><div class="s">طلب (كل الأشهر)</div></div>' : '') + '</div>';
    h += '<div class="grid2"><div class="panel"><h3>ترتيب المنافسة — نسبة تحقيق الهدف</h3>' + (lb.length ? '<div class="chartbox"><canvas id="cLb"></canvas></div>' : empty('لا توجد بيانات ترتيب')) + '</div>' +
      '<div class="panel"><h3>مسار التحقيق التراكمي مقابل المطلوب</h3>' + (ser.length || tot.tgt ? '<div class="chartbox"><canvas id="cPace"></canvas></div>' : empty('لا توجد بيانات')) + '<p class="note">المسار المطلوب خطي تقريبي على أيام الشهر.</p></div></div>';
    h += '<div class="panel"><div class="row" style="justify-content:space-between"><h3>أداء الموظفين</h3><button class="btn small" data-act="exp-dash" type="button">تصدير Excel</button></div>' +
      table([
        { h: 'الموظف', f: function (r) { return r.employee_name; } }, { h: 'الطلبات', num: 1, f: function (r) { return num(r.orders_count); } },
        { h: 'المحقَّق', num: 1, f: function (r) { return money(r.eligible_value); } }, { h: 'الهدف', num: 1, f: function (r) { return r.target == null ? '—' : money(r.target); } },
        { h: 'التحقيق', raw: 1, f: function (r) { return r.achievement == null ? '—' : '<div class="row"><div class="bar" style="width:90px"><i style="width:' + Math.min(100, r.achievement * 100) + '%;background:' + tierColor(r.achievement) + '"></i></div>' + pct(r.achievement) + '</div>'; } },
        { h: 'العمولة', num: 1, f: function (r) { return money(r.commission); } }
      ], st, { empty: 'لا توجد بيانات لهذا الشهر' }) + '</div>';
    v.innerHTML = h; S._dash = st;
    if (lb.length) {
      var sorted = lb.slice().sort(function (a, b) { return (b.achievement || 0) - (a.achievement || 0); });
      S.charts.push(new Chart($('#cLb'), { type: 'bar', data: { labels: sorted.map(function (r) { return (r.is_me ? '★ ' : '') + r.employee_name; }), datasets: [{ data: sorted.map(function (r) { return +(((r.achievement || 0) * 100).toFixed(1)); }), backgroundColor: sorted.map(function (r) { return tierColor(r.achievement); }), borderRadius: 4 }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { rtl: true, callbacks: { label: function (c) { return c.parsed.x + '%'; } } } }, scales: { x: { reverse: true, beginAtZero: true, ticks: { callback: function (x) { return x + '%'; } } }, y: { position: 'right' } } } }));
    }
    if ($('#cPace')) {
      var dim = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      var perDay = {}; ser.forEach(function (r) { perDay[Number(r.day.slice(8, 10))] = (perDay[Number(r.day.slice(8, 10))] || 0) + Number(r.value); });
      var labels = [], actual = [], req = [], run = 0; var tn = todayRiyadh(); var lastDay = tn.slice(0, 7) === m.slice(0, 7) ? Number(tn.slice(8, 10)) : dim;
      for (var d = 1; d <= dim; d++) { labels.push(String(d)); run += perDay[d] || 0; actual.push(d <= lastDay ? Math.round(run) : null); req.push(tot.tgt ? Math.round(tot.tgt * d / dim) : null); }
      S.charts.push(new Chart($('#cPace'), { type: 'line', data: { labels: labels, datasets: [{ label: 'المحقَّق', data: actual, borderColor: '#b8923a', backgroundColor: 'rgba(184,146,58,.15)', fill: true, tension: .2, pointRadius: 0 }, { label: 'المطلوب', data: req, borderColor: '#7a6f63', borderDash: [6, 4], pointRadius: 0 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { rtl: true }, tooltip: { rtl: true } }, scales: { x: { reverse: true }, y: { position: 'right', beginAtZero: true } } } }));
    }
  }

  /* ---------- orders ---------- */
  var ORDER_COLS = 'id,salla_order_id,reference_id,order_created_at,current_status,delivered_at,returned_at,subtotal,coupon_discount,special_discount,net_value,returned_value,coupon_code,assigned_salla_employee_id,by_code_employee_id,by_assigned_employee_id,employee_id,attribution_basis,source,selling_channel,is_eligible,review_status,review_reasons,review_note,reviewed_by,reviewed_at,import_source';
  function orderFilters() { var f = S.ofilter || (S.ofilter = { by: 'delivered', emp: '', review: '', basis: '', q: '', allm: false }); return f; }
  async function fetchOrders(page) {
    var f = orderFilters(); var col = f.by === 'created' ? 'order_created_at' : 'delivered_at';
    var q = S.sb.from('ps_orders').select(ORDER_COLS, { count: 'exact' }).order(col, { ascending: false, nullsFirst: false }).range(page * 200, page * 200 + 199);
    if (!f.allm) q = q.gte(col, riyadhStart(S.month)).lt(col, riyadhStart(nextMonth(S.month)));
    if (f.emp) q = q.eq('employee_id', f.emp);
    if (f.review) q = q.eq('review_status', f.review);
    if (f.basis) q = q.eq('attribution_basis', f.basis);
    if (f.q) q = q.or('salla_order_id.ilike.%' + f.q.replace(/[%,()]/g, '') + '%,reference_id.ilike.%' + f.q.replace(/[%,()]/g, '') + '%,coupon_code.ilike.%' + f.q.replace(/[%,()]/g, '') + '%');
    var r = await q; if (r.error) throw r.error; return r;
  }
  function orderRowsHtml(rows) {
    return table([
      { h: 'رقم الطلب', f: function (o) { return o.salla_order_id; } }, { h: 'المرجع', f: function (o) { return o.reference_id || '—'; } },
      { h: 'تاريخ التوصيل', f: function (o) { return fmtDT(o.delivered_at); } }, { h: 'الحالة', f: function (o) { return o.current_status || '—'; } },
      { h: 'الموظف', f: function (o) { return empName(o.employee_id); } }, { h: 'الكود', f: function (o) { return o.coupon_code || '—'; } },
      { h: 'دليل التحقق', raw: 1, f: function (o) { return tag(L.basis[o.attribution_basis] || o.attribution_basis, o.attribution_basis === 'conflict' ? 'bad' : (o.attribution_basis === 'both' ? 'ok' : (o.attribution_basis === 'none' ? '' : 'info'))); } },
      { h: 'الصافي', num: 1, f: function (o) { return money(o.net_value); } }, { h: 'مرتجع', num: 1, f: function (o) { return Number(o.returned_value) ? money(o.returned_value) : '—'; } },
      { h: 'المراجعة', raw: 1, f: function (o) { return o.review_status === 'none' ? '—' : tag(L.review[o.review_status], o.review_status === 'open' ? 'warn' : (o.review_status === 'excluded' ? 'bad' : 'ok')); } },
      { h: 'المصدر', f: function (o) { return L.src[o.import_source] || o.import_source; } }
    ], rows, { rowAttr: function (o) { return 'class="clk" data-act="order-detail" data-id="' + esc(o.id) + '"'; }, empty: 'لا توجد طلبات مطابقة' });
  }
  async function vOrders(v) {
    var f = orderFilters(); S.ordersPage = 0;
    var r = await fetchOrders(0); S.orderRows = r.data || []; S.ordersTotal = r.count || 0;
    var h = '<h2>الطلبات</h2><form class="filters" id="oFilter">' +
      '<label>ابحث (رقم/مرجع/كود)<input name="q" value="' + esc(f.q) + '"></label>' +
      '<label>التاريخ حسب<select name="by"><option value="delivered"' + (f.by === 'delivered' ? ' selected' : '') + '>تاريخ التوصيل</option><option value="created"' + (f.by === 'created' ? ' selected' : '') + '>تاريخ الطلب</option></select></label>' +
      (can('staff') ? '<label>الموظف<select name="emp"><option value="">الكل</option>' + S.emps.map(function (e) { return '<option value="' + e.id + '"' + (f.emp === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label>المراجعة<select name="review"><option value="">الكل</option>' + Object.keys(L.review).filter(function (k) { return k !== 'none'; }).map(function (k) { return '<option value="' + k + '"' + (f.review === k ? ' selected' : '') + '>' + L.review[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>دليل التحقق<select name="basis"><option value="">الكل</option>' + Object.keys(L.basis).map(function (k) { return '<option value="' + k + '"' + (f.basis === k ? ' selected' : '') + '>' + L.basis[k] + '</option>'; }).join('') + '</select></label>' +
      '<label><span>كل الأشهر</span><input type="checkbox" name="allm"' + (f.allm ? ' checked' : '') + '></label>' +
      '<button class="btn primary" type="submit">تطبيق</button>' +
      (can('enter') ? '<button class="btn gold" type="button" data-act="order-new">+ طلب يدوي</button>' : '') +
      '<button class="btn" type="button" data-act="exp-orders">تصدير Excel</button></form>' +
      '<p class="note" id="oCount">' + num(S.ordersTotal) + ' طلب — المعروض ' + num(S.orderRows.length) + (f.allm ? '' : ' (' + monthLabel(S.month) + ')') + '</p>' +
      '<div class="panel" id="oTable">' + orderRowsHtml(S.orderRows) + '</div>' +
      (S.orderRows.length < S.ordersTotal ? '<button class="btn" data-act="orders-more" type="button">تحميل المزيد</button>' : '');
    v.innerHTML = h;
  }
  function orderDetail(id) {
    var o = S.orderRows.find(function (x) { return x.id === id; }) || (S._revRows || []).find(function (x) { return x.id === id; }); if (!o) return;
    var reasons = (o.review_reasons || []).map(function (r) { return tag(L.reason[r] || r, 'warn'); }).join(' ') || '—';
    openDlg('طلب ' + o.salla_order_id,
      '<dl class="kv">' +
      '<dt>الرقم المرجعي</dt><dd>' + esc(o.reference_id || '—') + '</dd>' +
      '<dt>تاريخ الطلب</dt><dd>' + fmtDT(o.order_created_at) + '</dd><dt>تاريخ التوصيل</dt><dd>' + fmtDT(o.delivered_at) + '</dd><dt>تاريخ الإرجاع</dt><dd>' + fmtDT(o.returned_at) + '</dd>' +
      '<dt>الحالة</dt><dd>' + esc(o.current_status || '—') + '</dd>' +
      '<dt>المجموع الفرعي</dt><dd>' + money(o.subtotal) + '</dd><dt>خصم الكوبون</dt><dd>' + money(o.coupon_discount) + '</dd><dt>خصم خاص (لا يُخصم)</dt><dd>' + money(o.special_discount) + '</dd><dt>الصافي المعتمد للعمولة</dt><dd><b>' + money(o.net_value) + '</b></dd><dt>قيمة المرتجع</dt><dd>' + money(o.returned_value) + '</dd>' +
      '<dt>الكود المستخدم</dt><dd>' + esc(o.coupon_code || '—') + '</dd><dt>صاحب الكود</dt><dd>' + esc(empName(o.by_code_employee_id)) + '</dd>' +
      '<dt>موظف سلة المسند</dt><dd>' + esc(o.assigned_salla_employee_id || '—') + ' ← ' + esc(empName(o.by_assigned_employee_id)) + '</dd>' +
      '<dt>المنسوب إليه</dt><dd><b>' + esc(empName(o.employee_id)) + '</b></dd><dt>دليل التحقق</dt><dd>' + esc(L.basis[o.attribution_basis]) + '</dd>' +
      '<dt>القناة / المصدر</dt><dd>' + esc((o.selling_channel || '—') + ' / ' + (o.source || '—')) + '</dd>' +
      '<dt>حالة المراجعة</dt><dd>' + esc(L.review[o.review_status]) + '</dd><dt>أسباب الإحالة</dt><dd><div class="reasons">' + reasons + '</div></dd>' +
      '<dt>قرار المراجعة</dt><dd>' + esc(o.review_note || '—') + (o.reviewed_by ? ' — ' + esc(userName(o.reviewed_by)) + ' ' + fmtDT(o.reviewed_at) : '') + '</dd></dl>');
  }
  function dtLocal(v) { return v ? v + ':00+03:00' : ''; }
  function orderNewForm() {
    openDlg('طلب يدوي', '<form class="form" id="dForm" data-submit="order-new"><div class="formgrid">' +
      '<label>رقم الطلب (سلة)<input name="salla_order_id" required></label><label>الرقم المرجعي<input name="reference_id"></label>' +
      '<label>الحالة<select name="current_status"><option value="">—</option>' + S.statuses.map(function (s) { return '<option value="' + esc(s.salla_status_slug) + '">' + esc(s.salla_status_name || s.salla_status_slug) + ' (' + L.treat[s.treatment] + ')</option>'; }).join('') + '</select></label>' +
      '<label>تاريخ الطلب (توقيت الرياض)<input type="datetime-local" name="order_created_at"></label>' +
      '<label>تاريخ التوصيل (توقيت الرياض)<input type="datetime-local" name="delivered_at"></label><label>تاريخ الإرجاع<input type="datetime-local" name="returned_at"></label>' +
      '<label>المجموع الفرعي<input type="number" step="0.01" min="0" name="subtotal" required></label><label>خصم الكوبون<input type="number" step="0.01" min="0" name="coupon_discount" value="0"></label>' +
      '<label>خصم خاص<input type="number" step="0.01" min="0" name="special_discount" value="0"></label><label>قيمة المرتجع (للجزئي)<input type="number" step="0.01" min="0" name="returned_value" value="0"></label>' +
      '<label>كود الخصم<input name="coupon_code" dir="ltr"></label><label>قناة البيع<input name="selling_channel"></label></div>' +
      '<p class="note">يُنسب الطلب تلقائياً بالكود. أي طلب مشكوك فيه يظهر في قائمة المراجعة.</p><button class="btn primary" type="submit">حفظ</button></form>');
  }

  /* ---------- review queue ---------- */
  async function vReview(v) {
    var r = await S.sb.from('ps_orders').select(ORDER_COLS).eq('review_status', 'open').order('delivered_at', { ascending: false, nullsFirst: false }).limit(300);
    if (r.error) throw r.error; var rows = r.data || []; S._revRows = rows; S.reviewCount = rows.length; refreshFlags();
    var h = '<h2>طلبات تحتاج مراجعة ' + tag(String(rows.length), rows.length ? 'warn' : 'ok') + '</h2><p class="note">لا يُحتسب أي طلب هنا في العمولة حتى يُعتمد. ' + (can('decide') ? 'يلزم ذكر السبب مع كل قرار.' : 'القرار للمالية ومدير النظام.') + '</p>';
    if (!rows.length) h += empty('لا توجد طلبات بانتظار المراجعة ✓');
    rows.forEach(function (o) {
      h += '<div class="rv"><div class="hd"><div><b>' + esc(o.salla_order_id) + '</b> — ' + esc(empName(o.employee_id)) + ' — الكود: ' + esc(o.coupon_code || '—') + '</div><div>' + money(o.net_value) + ' ر.س</div></div>' +
        '<div class="reasons" style="margin:.4rem 0">' + (o.review_reasons || []).map(function (x) { return tag(L.reason[x] || x, 'warn'); }).join('') + '</div>' +
        '<div class="note">الحالة: ' + esc(o.current_status || '—') + ' | توصيل: ' + fmtDT(o.delivered_at) + ' | ' + esc(L.basis[o.attribution_basis]) + '</div>' +
        '<div class="row" style="margin-top:.5rem"><button class="btn small" data-act="order-detail" data-id="' + esc(o.id) + '" type="button">التفاصيل</button>' +
        (can('decide') ? '<button class="btn small ok" data-act="rv" data-d="approve" data-id="' + esc(o.id) + '" type="button">اعتماد</button><button class="btn small bad" data-act="rv" data-d="exclude" data-id="' + esc(o.id) + '" type="button">استبعاد</button><button class="btn small" data-act="rv" data-d="assign" data-id="' + esc(o.id) + '" type="button">إسناد لموظف</button>' : '') + '</div></div>';
    });
    v.innerHTML = h;
  }
  function reviewForm(id, d) {
    var o = (S._revRows || []).find(function (x) { return x.id === id; }) || {};
    var title = { approve: 'اعتماد الطلب ' + (o.salla_order_id || ''), exclude: 'استبعاد الطلب ' + (o.salla_order_id || ''), assign: 'إسناد الطلب ' + (o.salla_order_id || '') }[d];
    openDlg(title, '<form class="form" id="dForm" data-submit="review" data-id="' + esc(id) + '" data-d="' + d + '">' +
      (d === 'assign' ? '<label>الموظف<select name="emp" required><option value="">—</option>' + S.emps.map(function (e) { return '<option value="' + e.id + '">' + esc(e.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label>السبب (إلزامي)<textarea name="note" required placeholder="مثال: تم التحقق من العميل هاتفياً"></textarea></label><button class="btn primary" type="submit">تأكيد القرار</button></form>');
  }

  /* ---------- commissions ---------- */
  async function vComm(v) {
    var m = S.month; var st = await rpc('ps_statement', { p_month: m }); S._comm = st;
    var status = st.length ? st[0].status : 'live'; var all = function (s) { return st.length && st.every(function (r) { return r.status === s; }); };
    var ap = can('staff') ? await S.sb.from('ps_approvals').select('*').eq('entity', 'run').eq('entity_ref', m.slice(0, 7)).order('decided_at', { ascending: false }).limit(20) : { data: [] };
    var h = '<h2>العمولات — ' + monthLabel(m) + ' ' + tag(L.run[status] || status, status === 'locked' ? 'ok' : 'warn') + '</h2>';
    h += '<div class="panel"><p class="note">العمولة تُكتسب في شهر التوصيل (توقيت الرياض) وتُصرف في الشهر التالي. المرتجع بعد القفل يظهر كتسوية سالبة في كشف الشهر التالي ولا يُعاد فتح الشهر المقفول. الرصيد السالب يُرحَّل.</p><div class="row">' +
      (can('manage') ? '<button class="btn gold" data-act="gen" type="button"' + (status === 'locked' ? ' disabled' : '') + '>توليد / تحديث الكشف</button>' : '') +
      (can('finance') ? '<button class="btn ok" data-act="appr" data-s="finance" type="button"' + (all('draft') ? '' : ' disabled') + '>اعتماد المالية</button>' : '') +
      (can('ceo') ? '<button class="btn ok" data-act="appr" data-s="ceo" type="button"' + (all('finance_approved') ? '' : ' disabled') + '>اعتماد نهائي وقفل</button>' : '') +
      ((can('finance') || can('ceo')) && (all('draft') || all('finance_approved')) ? '<button class="btn bad" data-act="rej" type="button">رفض / إعادة للمسودة</button>' : '') +
      '<button class="btn" data-act="exp-comm" type="button">تصدير Excel</button></div></div>';
    h += '<div class="panel">' + table([
      { h: 'الموظف', f: function (r) { return r.employee_name; } }, { h: 'الطلبات', num: 1, f: function (r) { return num(r.orders_count); } },
      { h: 'المحقَّق', num: 1, f: function (r) { return money(r.eligible_value); } }, { h: 'الهدف', num: 1, f: function (r) { return r.target == null ? '—' : money(r.target); } },
      { h: 'التحقيق', num: 1, f: function (r) { return pct(r.achievement); } }, { h: 'العمولة', num: 1, f: function (r) { return money(r.commission); } },
      { h: 'تسويات المرتجع', num: 1, f: function (r) { return money(r.adjustments); } }, { h: 'رصيد مرحَّل', num: 1, f: function (r) { return money(r.carry_in); } },
      { h: 'الصافي المستحق', num: 1, raw: 1, f: function (r) { return '<b>' + money(r.net_payable) + '</b>'; } }, { h: 'يُرحَّل', num: 1, f: function (r) { return Number(r.carry_out) ? money(r.carry_out) : '—'; } },
      { h: 'الحالة', raw: 1, f: function (r) { return tag(L.run[r.status] || r.status, r.locked ? 'ok' : 'warn'); } }
    ], st, { rowAttr: function (r) { return 'class="clk" data-act="comm-detail" data-id="' + esc(r.employee_id) + '"'; }, empty: 'لا توجد كشوف أو أهداف لهذا الشهر بعد' }) + '</div>';
    if (can('staff')) h += '<div class="panel"><h3>سجل الاعتماد لهذا الشهر</h3>' + table([{ h: 'الوقت', f: function (r) { return fmtDT(r.decided_at); } }, { h: 'المرحلة', f: function (r) { return r.stage === 'generate' ? 'توليد' : (r.stage === 'finance' ? 'المالية' : (r.stage === 'ceo' ? 'المدير التنفيذي' : r.stage)); } }, { h: 'القرار', f: function (r) { return L.dec[r.decision] || r.decision; } }, { h: 'بواسطة', f: function (r) { return userName(r.decided_by); } }, { h: 'ملاحظة', wrap: 1, f: function (r) { return r.note || ''; } }], ap.data || [], { empty: 'لا يوجد سجل بعد' }) + '</div>';
    v.innerHTML = h;
  }
  async function commDetail(empId) {
    var m = S.month; var s = riyadhStart(m), e = riyadhStart(nextMonth(m));
    var o = await S.sb.from('ps_orders').select(ORDER_COLS).eq('employee_id', empId).gte('delivered_at', s).lt('delivered_at', e).order('delivered_at');
    var ev = await S.sb.from('ps_commission_events').select('*').eq('employee_id', empId).eq('earned_month', m).eq('event_type', 'adjustment');
    S.orderRows = o.data || [];
    openDlg(empName(empId) + ' — ' + monthLabel(m),
      '<h3>الطلبات المُسلَّمة في الشهر</h3>' + table([{ h: 'الطلب', f: function (x) { return x.salla_order_id; } }, { h: 'التوصيل', f: function (x) { return fmtDT(x.delivered_at); } }, { h: 'الحالة', f: function (x) { return x.current_status || ''; } }, { h: 'الصافي', num: 1, f: function (x) { return money(x.net_value); } }, { h: 'المراجعة', f: function (x) { return L.review[x.review_status]; } }], S.orderRows, { empty: 'لا توجد طلبات' }) +
      '<h3 style="margin-top:1rem">تسويات مرتجعات لاحقة تخص هذا الكشف</h3>' + table([{ h: 'تاريخ التسجيل', f: function (x) { return fmtDT(x.recorded_at); } }, { h: 'المبلغ', num: 1, f: function (x) { return money(x.value_delta); } }, { h: 'السبب', wrap: 1, f: function (x) { return x.note || ''; } }], ev.data || [], { empty: 'لا توجد تسويات' }));
  }

  /* ---------- daily log ---------- */
  async function vDaily(v) {
    var meId = S.profile.employee_id; var isRep = S.role === 'sales_rep';
    var d = new Date(); d.setDate(d.getDate() - 45); var since = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
    var rows = (await sel(S.sb.from('ps_daily_log').select('*').gte('log_date', since).order('log_date', { ascending: false }).limit(500))) || [];
    S._daily = rows;
    var h = '<h2>التسجيل اليومي للمبيعات الهاتفية</h2>';
    if (can('enter') || isRep) {
      h += '<div class="panel"><form class="form" id="dailyForm" data-submit="daily"><div class="formgrid">' +
        '<label>التاريخ<input type="date" name="log_date" value="' + todayRiyadh() + '" required></label>' +
        '<label>الموظف<select name="employee" required>' + S.emps.filter(function (e) { return !isRep || e.id === meId; }).map(function (e) { return '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>العملاء المسندون<input type="number" min="0" name="assigned_customers" value="0"></label><label>تم التواصل<input type="number" min="0" name="contacted" value="0"></label>' +
        '<label>تم التحويل لطلب<input type="number" min="0" name="converted" value="0"></label><label>عدد الطلبات<input type="number" min="0" name="orders_count" value="0"></label>' +
        '<label>قيمة الطلبات<input type="number" min="0" step="0.01" name="value" value="0"></label><label>القناة<input name="channel" value="هاتف مباشر"></label></div>' +
        '<label>ملاحظات<input name="notes"></label><button class="btn primary" type="submit">حفظ اليوم</button><p class="note">هذا السجل للمتابعة التشغيلية. العمولة تُحسب من الطلبات المُسلَّمة فقط وليس من هذا السجل.</p></form></div>';
    }
    h += '<div class="panel"><div class="row" style="justify-content:space-between"><h3>آخر 45 يوماً</h3><button class="btn small" data-act="exp-daily" type="button">تصدير Excel</button></div>' + table([
      { h: 'التاريخ', f: function (r) { return r.log_date; } }, { h: 'الموظف', f: function (r) { return empName(r.employee_id); } }, { h: 'مسند', num: 1, f: function (r) { return r.assigned_customers; } },
      { h: 'تواصل', num: 1, f: function (r) { return r.contacted; } }, { h: 'تحويل', num: 1, f: function (r) { return r.converted; } }, { h: 'طلبات', num: 1, f: function (r) { return r.orders_count; } },
      { h: 'القيمة', num: 1, f: function (r) { return money(r.value); } }, { h: 'القناة', f: function (r) { return r.channel; } }, { h: 'ملاحظات', wrap: 1, f: function (r) { return r.notes || ''; } }], rows) + '</div>';
    v.innerHTML = h;
  }

  /* ---------- Excel import ---------- */
  var SYN = {
    salla_order_id: ['رقم الطلب', 'order_id', 'salla_order_id', 'id'], reference_id: ['الرقم المرجعي', 'reference_id', 'reference'],
    order_created_at: ['تاريخ الطلب', 'تاريخ الإنشاء', 'created_at', 'order_created_at'], current_status: ['حالة الطلب', 'الحالة', 'status', 'current_status'],
    delivered_at: ['تاريخ التوصيل', 'delivered_at'], returned_at: ['تاريخ الإرجاع', 'تاريخ المرتجع', 'returned_at'],
    subtotal: ['المجموع الفرعي', 'المبلغ قبل الخصم', 'subtotal'], coupon_discount: ['خصم الكوبون', 'قيمة الكوبون', 'coupon_discount'],
    special_discount: ['خصم خاص', 'الخصم الخاص', 'special_discount'], total: ['الإجمالي', 'total'], returned_value: ['قيمة المرتجع', 'returned_value'],
    coupon_code: ['كود الخصم', 'الكوبون', 'coupon_code', 'coupon'], selling_channel: ['قناة البيع', 'selling_channel'], source: ['المصدر', 'source'],
    assigned_salla_employee_id: ['موظف سلة', 'الموظف المسند', 'assigned_employee_id']
  };
  var DSYN = { log_date: ['التاريخ', 'log_date', 'date'], employee: ['الموظف', 'employee', 'name'], assigned_customers: ['العملاء المسندون', 'assigned_customers'], contacted: ['تم التواصل', 'contacted'], converted: ['تم التحويل', 'converted'], orders_count: ['عدد الطلبات', 'orders_count'], value: ['القيمة', 'قيمة الطلبات', 'value'], channel: ['القناة', 'channel'], notes: ['ملاحظات', 'notes'] };
  function ar2en(s) { return String(s).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }); }
  function cleanNum(v) { if (v == null || v === '') return ''; if (typeof v === 'number') return String(v); var s = ar2en(v).replace(/[,،\s]/g, '').replace(/ر\.?س|SAR/gi, ''); return s; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toIso(v, dateOnly) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { var p = XLSX.SSF.parse_date_code(v); if (!p) return 'INVALID'; return p.y + '-' + pad(p.m) + '-' + pad(p.d) + (dateOnly ? '' : 'T' + pad(p.H) + ':' + pad(p.M) + ':' + pad(Math.floor(p.S)) + '+03:00'); }
    var s = ar2en(v).trim(); if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) && /T/.test(s)) return s;
    var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) { var m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); if (m2) m = [0, m2[3], m2[2], m2[1], m2[4], m2[5], m2[6]]; }
    if (!m) return 'INVALID';
    var out = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]); if (dateOnly) return out;
    return out + 'T' + pad(m[4] || 0) + ':' + pad(m[5] || 0) + ':' + pad(m[6] || 0) + '+03:00';
  }
  function mapRows(raw, syn, dateFields, numFields) {
    var out = [], bad = [];
    raw.forEach(function (r, i) {
      var o = {}; var keys = Object.keys(r);
      Object.keys(syn).forEach(function (k) {
        var hit = keys.find(function (x) { return syn[k].indexOf(String(x).trim()) > -1 || syn[k].map(function (s) { return s.toLowerCase(); }).indexOf(String(x).trim().toLowerCase()) > -1; });
        var val = hit == null ? '' : r[hit];
        if (dateFields.indexOf(k) > -1) { var iso = toIso(val, k === 'log_date'); if (iso === 'INVALID') bad.push('سطر ' + (i + 2) + ': تاريخ غير صالح في ' + k); val = iso; }
        else if (numFields.indexOf(k) > -1) { val = cleanNum(val); if (val !== '' && !isFinite(Number(val))) bad.push('سطر ' + (i + 2) + ': رقم غير صالح في ' + k); }
        else val = val == null ? '' : String(val).trim();
        o[k] = val;
      });
      out.push(o);
    });
    return { rows: out, bad: bad };
  }
  async function vImport(v) {
    v.innerHTML = '<h2>استيراد Excel</h2><p class="note">الاستيراد آمن للتكرار: نفس رقم الطلب يُحدَّث ولا يتكرر. إذا وُجد خطأ في أي سطر لا يُحفظ شيء من ذلك الدفعة. الطلبات القادمة من مزامنة سلة لا تُستبدل بالاستيراد اليدوي.</p>' +
      '<div class="grid2"><div class="panel"><h3>الطلبات</h3><div class="row"><button class="btn small" data-act="tpl-orders" type="button">تنزيل القالب</button></div><p><input type="file" id="fOrders" accept=".xlsx,.xls,.csv"></p><div id="pvOrders"></div></div>' +
      '<div class="panel"><h3>التسجيل اليومي</h3><div class="row"><button class="btn small" data-act="tpl-daily" type="button">تنزيل القالب</button></div><p><input type="file" id="fDaily" accept=".xlsx,.xls,.csv"></p><div id="pvDaily"></div></div></div>';
  }
  async function readFile(file) {
    var buf = await file.arrayBuffer(); var wb = XLSX.read(buf, { type: 'array', cellDates: false }); var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  }
  async function onFile(kind, file) {
    var box = $(kind === 'orders' ? '#pvOrders' : '#pvDaily'); box.innerHTML = '<p class="note">جارٍ القراءة…</p>';
    try {
      var raw = await readFile(file); if (!raw.length) { box.innerHTML = empty('الملف فارغ'); return; }
      var res = kind === 'orders' ? mapRows(raw, SYN, ['order_created_at', 'delivered_at', 'returned_at'], ['subtotal', 'coupon_discount', 'special_discount', 'total', 'returned_value'])
        : mapRows(raw, DSYN, ['log_date'], ['assigned_customers', 'contacted', 'converted', 'orders_count', 'value']);
      var miss = kind === 'orders' ? res.rows.filter(function (r) { return !r.salla_order_id; }).length : res.rows.filter(function (r) { return !r.employee || !r.log_date; }).length;
      S['_imp_' + kind] = res.rows;
      var cols = kind === 'orders' ? ['salla_order_id', 'current_status', 'delivered_at', 'subtotal', 'coupon_discount', 'coupon_code'] : ['log_date', 'employee', 'orders_count', 'value'];
      box.innerHTML = '<p><b>' + num(res.rows.length) + '</b> سطر' + (miss ? ' — <span class="tag bad">' + miss + ' سطر ناقص البيانات الأساسية</span>' : '') + '</p>' +
        (res.bad.length ? '<div class="tag bad" style="display:block;white-space:normal;margin-bottom:.5rem">' + esc(res.bad.slice(0, 6).join(' | ')) + (res.bad.length > 6 ? ' …' : '') + '</div>' : '') +
        table(cols.map(function (c) { return { h: c, f: function (r) { return r[c]; } }; }), res.rows.slice(0, 8)) +
        '<p><button class="btn primary" data-act="do-import" data-k="' + kind + '" type="button"' + (res.bad.length || miss ? ' disabled' : '') + '>استيراد ' + num(res.rows.length) + ' سطر</button></p><div id="res_' + kind + '"></div>';
    } catch (e) { box.innerHTML = empty('تعذّرت قراءة الملف: ' + errText(e)); }
  }
  async function doImport(kind, btn) {
    var rows = S['_imp_' + kind]; if (!rows || !rows.length) return; var out = $('#res_' + kind); btn.disabled = true; out.innerHTML = '<p class="note">جارٍ الاستيراد…</p>';
    var ins = 0, upd = 0, skip = 0, saved = 0;
    for (var i = 0; i < rows.length; i += 400) {
      var chunk = rows.slice(i, i + 400);
      var r = await rpc(kind === 'orders' ? 'ps_import_orders' : 'ps_import_daily', kind === 'orders' ? { p_rows: chunk, p_source: 'import' } : { p_rows: chunk });
      if (!r.ok) { out.innerHTML = '<div class="tag bad" style="display:block;white-space:normal">لم تُحفظ هذه الدفعة (من السطر ' + (i + 1) + '):<br>' + r.errors.slice(0, 12).map(function (e) { return esc('سطر ' + (i + e.row + 1) + ': ' + e.msg); }).join('<br>') + '</div><p class="note">ما سبق من دفعات محفوظ، وإعادة الاستيراد بعد التصحيح آمنة.</p>'; btn.disabled = false; return; }
      ins += r.inserted || 0; upd += r.updated || 0; skip += r.skipped_sync || 0; saved += r.saved || 0;
    }
    out.innerHTML = '<div class="tag ok" style="display:block;white-space:normal">' + (kind === 'orders' ? 'تم: جديد ' + ins + ' — محدَّث ' + upd + (skip ? ' — تجاوُز (من سلة) ' + skip : '') : 'تم حفظ ' + saved + ' سجل') + '</div>';
    refreshFlags();
  }
  function downloadTemplate(kind) {
    var rows = kind === 'orders'
      ? [{ 'رقم الطلب': '123456', 'الرقم المرجعي': '2000001', 'تاريخ الطلب': '2026-11-16 10:30', 'حالة الطلب': 'تم التوصيل', 'تاريخ التوصيل': '2026-11-19 14:05', 'تاريخ الإرجاع': '', 'المجموع الفرعي': 850, 'خصم الكوبون': 85, 'خصم خاص': 0, 'الإجمالي': 790, 'قيمة المرتجع': 0, 'كود الخصم': 'HK', 'قناة البيع': '', 'المصدر': '' }]
      : [{ 'التاريخ': '2026-11-16', 'الموظف': 'هاني الحارثي', 'العملاء المسندون': 12, 'تم التواصل': 10, 'تم التحويل': 3, 'عدد الطلبات': 3, 'القيمة': 2400, 'القناة': 'هاتف مباشر', 'ملاحظات': '' }];
    exportXlsx(kind === 'orders' ? 'قالب-استيراد-الطلبات' : 'قالب-التسجيل-اليومي', rows);
  }

  /* ---------- settings & targets (under development) ---------- */
  var SUBS = [['targets', 'الأهداف'], ['rules', 'الشرائح والقواعد'], ['limits', 'حدود المراجعة'], ['people', 'الموظفون والأكواد'], ['status', 'تصنيف الحالات'], ['users', 'المستخدمون', 'manage'], ['audit', 'سجل التدقيق', 'audit']];
  async function vSettings(v) {
    var subs = SUBS.filter(function (s) { return !s[2] || can(s[2]); }); if (!subs.some(function (s) { return s[0] === S.sub; })) S.sub = 'targets';
    var h = '<h2>الأهداف والإعدادات</h2><div class="dev">هذه الصفحة قيد التطوير: أي تعديل على الأهداف أو الشرائح يبقى «مسودة» حتى يعتمده المدير التنفيذي، ولا يسري على الشهر الجاري (التجميد).</div><div class="sub">' +
      subs.map(function (s) { return '<button type="button" data-act="sub" data-s="' + s[0] + '" class="' + (S.sub === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') + '</div><div id="subBody"></div>';
    v.innerHTML = h; await ({ targets: sTargets, rules: sRules, limits: sLimits, people: sPeople, status: sStatus, users: sUsers, audit: sAudit }[S.sub])($('#subBody'));
  }
  function smoothShare(w, sw, s) { return s * w / sw + (1 - s) / 12; }
  function previewPlan(p, weights) {
    var sw = 0; weights.forEach(function (x) { sw += Number(x.weight); }); var out = []; var m = p.first_month;
    while (m <= p.last_month) {
      var mo = Number(m.slice(5, 7)); var w = weights.find(function (x) { return x.month_no === mo; }); var sh = smoothShare(Number(w.weight), sw, Number(p.smoothing));
      var dim = new Date(Number(m.slice(0, 4)), mo, 0).getDate(); var pr = 1;
      if (p.start_date) { var sm = p.start_date.slice(0, 7) + '-01'; if (sm === m) pr = Math.max(0, Math.min(1, (dim - Number(p.start_date.slice(8, 10)) + 1) / dim)); else if (m < sm) pr = 0; }
      out.push({ month: m, share: sh, proration: pr, team_target: Math.round(Number(p.annual_target) * sh * pr * 100) / 100 }); m = nextMonth(m);
    }
    return out;
  }
  async function sTargets(b) {
    var plans = await sel(S.sb.from('ps_target_plans').select('*').order('created_at', { ascending: false }));
    var w = await sel(S.sb.from('ps_month_weights').select('*').eq('method', 'm3').order('month_no')); S._w = w; S._plans = plans;
    var emps = S.emps.filter(function (e) { return e.is_active && e.confirm_status === 'confirmed'; }); var sumW = emps.reduce(function (a, e) { return a + Number(e.share_weight); }, 0);
    var sel0 = plans.find(function (p) { return p.id === S.planSel; }) || plans.find(function (p) { return p.status === 'approved'; }) || plans[0]; if (sel0) S.planSel = sel0.id;
    var h = '<div class="panel"><h3>خطط الأهداف السنوية</h3>' + table([
      { h: 'الخطة', f: function (p) { return p.label; } }, { h: 'السنوي', num: 1, f: function (p) { return money(p.annual_target); } }, { h: 'التوزيع', f: function (p) { return p.method + ' / تمهيد ' + p.smoothing; } },
      { h: 'من → إلى', f: function (p) { return p.first_month.slice(0, 7) + ' → ' + p.last_month.slice(0, 7); } }, { h: 'الحالة', raw: 1, f: function (p) { return tag(L.plan[p.status], p.status === 'approved' ? 'ok' : (p.status === 'rejected' ? 'bad' : 'warn')); } },
      { h: '', raw: 1, f: function (p) { return '<button class="btn small" data-act="plan-view" data-id="' + p.id + '" type="button">عرض</button> ' + (p.status === 'draft' && can('manage') ? '<button class="btn small gold" data-act="plan-req" data-id="' + p.id + '" type="button">طلب اعتماد</button> <button class="btn small bad" data-act="plan-del" data-id="' + p.id + '" type="button">حذف</button>' : '') + (p.status === 'pending_ceo' && can('ceo') ? '<button class="btn small ok" data-act="plan-dec" data-d="approve" data-id="' + p.id + '" type="button">اعتماد</button> <button class="btn small bad" data-act="plan-dec" data-d="reject" data-id="' + p.id + '" type="button">رفض</button>' : ''); } }
    ], plans, { empty: 'لا توجد خطط' }) + (can('manage') ? '<p><button class="btn primary" data-act="plan-new" type="button">+ خطة جديدة (رفع الهدف)</button></p>' : '') + '</div>';
    if (sel0) {
      var tg = sel0.status === 'draft' ? previewPlan(sel0, w) : await sel(S.sb.from('ps_targets').select('*').eq('plan_id', sel0.id).order('month'));
      h += '<div class="panel"><h3>توزيع الخطة «' + esc(sel0.label) + '» ' + (sel0.status === 'draft' ? tag('معاينة — لم تُعتمد', 'warn') : '') + '</h3><div class="tscroll"><table><thead><tr><th>الشهر</th><th class="num">النسبة</th><th class="num">التناسب (بداية)</th><th class="num">هدف الفريق</th><th class="num">لكل موظف (' + emps.length + ')</th></tr></thead><tbody>' +
        tg.map(function (t) { return '<tr><td>' + monthLabel(t.month) + '</td><td class="num">' + (Number(t.share) * 100).toFixed(2) + '%</td><td class="num">' + (Number(t.proration) * 100).toFixed(0) + '%</td><td class="num">' + money(t.team_target) + '</td><td class="num">' + (sumW ? money(Number(t.team_target) / sumW) : '—') + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="note">يتوزع هدف الفريق تلقائياً على الموظفين الفعّالين المؤكدين بحسب أوزانهم (حالياً متساوية). الموظف الجديد يدخل التوزيع من تاريخ بدايته.</p></div>';
    }
    b.innerHTML = h;
  }
  function planForm() {
    openDlg('خطة هدف جديدة', '<form class="form" id="dForm" data-submit="plan-new"><div class="formgrid">' +
      '<label>الاسم<input name="label" required value="خطة جديدة"></label><label>السيناريو<select name="scenario"><option value="6M">6 مليون</option><option value="5M">5 مليون</option><option value="custom">مخصص</option></select></label>' +
      '<label>الهدف السنوي (ر.س)<input type="number" min="1" step="1" name="annual_target" required value="6000000"></label>' +
      '<label>طريقة توزيع الأشهر<select name="method"><option value="m3">م3 (موسمي مخفَّف)</option><option value="m5">م5 (موسمي كامل)</option></select></label>' +
      '<label>درجة التمهيد (0–1)<input type="number" min="0" max="1" step="0.05" name="smoothing" value="0.8"></label><label>بداية التشغيل<input type="date" name="start_date" value="2026-11-15"></label>' +
      '<label>أول شهر<select name="first_month">' + MONTHS.map(function (m) { return '<option value="' + m + '">' + monthLabel(m) + '</option>'; }).join('') + '</select></label>' +
      '<label>آخر شهر<select name="last_month">' + MONTHS.map(function (m, i) { return '<option value="' + m + '"' + (i === MONTHS.length - 1 ? ' selected' : '') + '>' + monthLabel(m) + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="note">تُحفظ كمسودة ثم تُرسل لاعتماد المدير التنفيذي. التغيير يسري على الأشهر التي لم تبدأ بعد.</p><button class="btn primary" type="submit">حفظ كمسودة</button></form>');
  }
  async function sRules(b) {
    var vs = await sel(S.sb.from('ps_rule_versions').select('*').order('version', { ascending: false })); var ts = await sel(S.sb.from('ps_commission_tiers').select('*').order('from_pct'));
    var conf = S.rulesConfirmed === true;
    var h = '<div class="panel"><h3>التأكيد الكتابي للقواعد ' + tag(conf ? 'مؤكدة' : 'غير مؤكدة', conf ? 'ok' : 'warn') + '</h3><p class="note">لا قفل نهائي لأي شهر قبل أن يؤكد المدير التنفيذي وجود تأكيد كتابي للشرائح.</p>' + (can('ceo') ? '<button class="btn ' + (conf ? 'bad' : 'ok') + ' small" data-act="confirm-rules" data-v="' + (conf ? '0' : '1') + '" type="button">' + (conf ? 'سحب التأكيد' : 'تأكيد القواعد كتابياً') + '</button>' : '') + '</div>';
    vs.forEach(function (r) {
      var tt = ts.filter(function (t) { return t.version === r.version; });
      h += '<div class="panel"><div class="row" style="justify-content:space-between"><h3>النسخة ' + r.version + ' ' + tag(L.plan[r.status] || r.status, r.status === 'approved' ? 'ok' : (r.status === 'rejected' ? 'bad' : 'warn')) + '</h3><span class="note">تسري من ' + r.effective_from.slice(0, 7) + '</span></div>' +
        '<p class="note">' + esc(L.method[r.method]) + ' — فوق 100%: ' + esc(L.over[r.over100]) + ' (+' + (Number(r.extra_rate) * 100).toFixed(1) + '%) — خصم الخاص: ' + (r.deduct_special ? 'نعم' : 'لا') + (r.note ? ' — ' + esc(r.note) : '') + '</p>' +
        table([{ h: 'من', num: 1, f: function (t) { return (t.from_pct * 100).toFixed(0) + '%'; } }, { h: 'إلى', num: 1, f: function (t) { return (t.to_pct * 100).toFixed(0) + '%'; } }, { h: 'النسبة', num: 1, f: function (t) { return (t.rate * 100).toFixed(2) + '%'; } }], tt) +
        '<div class="row" style="margin-top:.5rem">' + (r.status === 'draft' && can('manage') ? '<button class="btn small gold" data-act="rule-req" data-v="' + r.version + '" type="button">طلب اعتماد</button>' : '') + (r.status === 'pending_ceo' && can('ceo') ? '<button class="btn small ok" data-act="rule-dec" data-d="approve" data-v="' + r.version + '" type="button">اعتماد</button><button class="btn small bad" data-act="rule-dec" data-d="reject" data-v="' + r.version + '" type="button">رفض</button>' : '') + '</div></div>';
    });
    if (can('manage')) h += '<p><button class="btn primary" data-act="rule-new" type="button">+ نسخة قواعد جديدة</button></p>';
    b.innerHTML = h;
  }
  function ruleForm() {
    var nm = nextMonth(todayRiyadh().slice(0, 7) + '-01');
    openDlg('نسخة قواعد جديدة', '<form class="form" id="dForm" data-submit="rule-new"><div class="formgrid">' +
      '<label>تسري من (أول الشهر)<select name="effective_from">' + MONTHS.filter(function (m) { return m >= nm; }).map(function (m) { return '<option value="' + m + '">' + monthLabel(m) + '</option>'; }).join('') + '</select></label>' +
      '<label>الطريقة<select name="method"><option value="marginal">تصاعدي بالشريحة</option><option value="tier_on_all">الشريحة على كامل المبلغ</option></select></label>' +
      '<label>فوق 100%<select name="over100"><option value="stacked">تراكمي</option><option value="flat_1">إضافة ثابتة</option></select></label>' +
      '<label>الإضافة فوق 100% (كنسبة)<input type="number" step="0.001" min="0" name="extra_rate" value="0.01"></label></div>' +
      '<h3>الشرائح (نسبة من الهدف → نسبة العمولة)</h3><div id="tiers"></div><button class="btn small" type="button" data-act="tier-add">+ شريحة</button>' +
      '<label>ملاحظة / مرجع القرار<input name="note"></label><button class="btn primary" type="submit">حفظ كمسودة</button></form>');
    var defaults = [[0, 50, 0], [50, 70, 1], [70, 90, 1.5], [90, 100, 2]]; defaults.forEach(function (d) { addTier(d); });
  }
  function addTier(d) { var div = document.createElement('div'); div.className = 'formgrid tier'; div.innerHTML = '<label>من %<input type="number" step="0.1" min="0" name="f" value="' + d[0] + '"></label><label>إلى %<input type="number" step="0.1" min="0" name="t" value="' + d[1] + '"></label><label>عمولة %<input type="number" step="0.01" min="0" name="r" value="' + d[2] + '"></label>'; $('#tiers').appendChild(div); }
  async function sLimits(b) {
    var rows = await sel(S.sb.from('ps_settings').select('*').order('key')); var lab = { review_return_days: 'مرتجع مبكر خلال (أيام من التوصيل)', review_outlier_multiple: 'قيمة شاذة إذا زادت عن (× وسيط الموظف)', review_repeat_customer_count: 'عميل متكرر: عدد الطلبات', review_repeat_customer_days: 'عميل متكرر: خلال (أيام)', require_month_end: 'منع القفل قبل نهاية الشهر', leaderboard_visible_to_reps: 'إظهار ترتيب الجميع للمناديب', rules_confirmed: 'قواعد مؤكدة كتابياً' };
    b.innerHTML = '<div class="panel"><h3>حدود الإحالة للمراجعة</h3><p class="note">تعديل هذه الحدود يغيّر فقط ما يُحال للمراجعة مستقبلاً.</p>' + table([
      { h: 'الإعداد', f: function (r) { return lab[r.key] || r.key; } }, { h: 'القيمة', raw: 1, f: function (r) { var val = r.value === true ? 'true' : (r.value === false ? 'false' : String(r.value)); if (r.key === 'rules_confirmed' || !can('manage')) return esc(val); return '<form class="row" data-submit="setting" data-k="' + esc(r.key) + '"><input name="v" value="' + esc(val) + '" style="width:110px"><button class="btn small" type="submit">حفظ</button></form>'; } }
    ], rows) + '</div>';
  }
  async function sPeople(b) {
    var codes = await sel(S.sb.from('ps_discount_codes').select('*').order('code')); var sal = await sel(S.sb.from('ps_salla_employees').select('*')); S._codes = codes;
    var emps = S.emps;
    b.innerHTML = '<div class="panel"><div class="row" style="justify-content:space-between"><h3>الموظفون</h3>' + (can('manage') ? '<button class="btn small gold" data-act="emp-new" type="button">+ موظف</button>' : '') + '</div>' + table([
      { h: 'الاسم', f: function (e) { return e.name; } }, { h: 'الحالة', raw: 1, f: function (e) { return tag(e.is_active ? 'فعّال' : 'موقوف', e.is_active ? 'ok' : ''); } }, { h: 'التأكيد', raw: 1, f: function (e) { return tag(e.confirm_status === 'confirmed' ? 'مؤكد' : 'بانتظار التأكيد', e.confirm_status === 'confirmed' ? 'ok' : 'warn'); } },
      { h: 'الوزن', num: 1, f: function (e) { return e.share_weight; } }, { h: 'بداية', f: function (e) { return e.start_date || '—'; } }, { h: 'نهاية', f: function (e) { return e.end_date || '—'; } },
      { h: 'الأكواد', f: function (e) { return codes.filter(function (c) { return c.employee_id === e.id; }).map(function (c) { return c.code + (c.confirm_status === 'pending' ? '؟' : ''); }).join('، ') || '—'; } },
      { h: '', raw: 1, f: function (e) { return can('manage') ? '<button class="btn small" data-act="emp-edit" data-id="' + e.id + '" type="button">تعديل</button>' : ''; } }], emps) + '</div>' +
      '<div class="panel"><div class="row" style="justify-content:space-between"><h3>أكواد الخصم</h3>' + (can('manage') ? '<button class="btn small gold" data-act="code-new" type="button">+ كود</button>' : '') + '</div><p class="note">الكود غير المؤكد لا يُنسب له أي طلب ويذهب الطلب للمراجعة.</p>' + table([
        { h: 'الكود', f: function (c) { return c.code; } }, { h: 'الموظف', f: function (c) { return empName(c.employee_id); } }, { h: 'الحالة', raw: 1, f: function (c) { return tag(c.is_active ? 'فعّال' : 'موقوف', c.is_active ? 'ok' : ''); } }, { h: 'التأكيد', raw: 1, f: function (c) { return tag(c.confirm_status === 'confirmed' ? 'مؤكد' : 'بانتظار التأكيد', c.confirm_status === 'confirmed' ? 'ok' : 'warn'); } },
        { h: '', raw: 1, f: function (c) { return can('manage') ? '<button class="btn small" data-act="code-edit" data-id="' + c.id + '" type="button">تعديل</button>' : ''; } }], codes) + '</div>' +
      '<div class="panel"><h3>ربط موظفي سلة</h3><p class="note">يُستخدم عند تفعيل المزامنة لمطابقة «الموظف المسند» في سلة مع الموظف هنا.</p>' + table([{ h: 'معرّف موظف سلة', f: function (r) { return r.salla_employee_id; } }, { h: 'الموظف', f: function (r) { return empName(r.employee_id); } }], sal, { empty: 'لا يوجد ربط بعد (يُضاف عند المرحلة 1)' }) + '</div>';
  }
  function empForm(e) {
    e = e || {}; openDlg(e.id ? 'تعديل موظف' : 'موظف جديد', '<form class="form" id="dForm" data-submit="emp" data-id="' + esc(e.id || '') + '"><div class="formgrid">' +
      '<label>الاسم<input name="name" required value="' + esc(e.name || '') + '"></label><label>الوزن (للتوزيع)<input type="number" step="0.001" min="0.001" name="share_weight" value="' + esc(e.share_weight || 1) + '"></label>' +
      '<label>تاريخ البداية<input type="date" name="start_date" value="' + esc(e.start_date || '') + '"></label><label>تاريخ النهاية<input type="date" name="end_date" value="' + esc(e.end_date || '') + '"></label>' +
      '<label>التأكيد<select name="confirm_status"><option value="confirmed"' + (e.confirm_status !== 'pending' ? ' selected' : '') + '>مؤكد</option><option value="pending"' + (e.confirm_status === 'pending' ? ' selected' : '') + '>بانتظار التأكيد</option></select></label>' +
      '<label>الحالة<select name="is_active"><option value="true"' + (e.is_active !== false ? ' selected' : '') + '>فعّال</option><option value="false"' + (e.is_active === false ? ' selected' : '') + '>موقوف</option></select></label></div><button class="btn primary" type="submit">حفظ</button></form>');
  }
  function codeForm(c) {
    c = c || {}; openDlg(c.id ? 'تعديل كود' : 'كود جديد', '<form class="form" id="dForm" data-submit="code" data-id="' + esc(c.id || '') + '"><div class="formgrid">' +
      '<label>الكود<input name="code" required dir="ltr" value="' + esc(c.code || '') + '"></label><label>الموظف<select name="employee_id" required>' + S.emps.map(function (e) { return '<option value="' + e.id + '"' + (c.employee_id === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>التأكيد<select name="confirm_status"><option value="confirmed"' + (c.confirm_status !== 'pending' ? ' selected' : '') + '>مؤكد</option><option value="pending"' + (c.confirm_status === 'pending' ? ' selected' : '') + '>بانتظار التأكيد</option></select></label>' +
      '<label>الحالة<select name="is_active"><option value="true"' + (c.is_active !== false ? ' selected' : '') + '>فعّال</option><option value="false"' + (c.is_active === false ? ' selected' : '') + '>موقوف</option></select></label></div><button class="btn primary" type="submit">حفظ</button></form>');
  }
  async function sStatus(b) {
    b.innerHTML = '<div class="panel"><h3>تصنيف حالات الطلب في سلة</h3><p class="note">كل حالة جديدة غير معرّفة تُحيل الطلب للمراجعة. «تم التوصيل» هي الحالة الوحيدة المُنشئة للعمولة؛ المرتجعات تُخصم.</p>' + table([
      { h: 'الرمز (slug)', f: function (s) { return s.salla_status_slug; } }, { h: 'الاسم', f: function (s) { return s.salla_status_name; } }, { h: 'المعاملة', raw: 1, f: function (s) { return can('manage') ? '<form class="row" data-submit="status" data-k="' + esc(s.salla_status_slug) + '"><select name="t">' + Object.keys(L.treat).map(function (k) { return '<option value="' + k + '"' + (s.treatment === k ? ' selected' : '') + '>' + L.treat[k] + '</option>'; }).join('') + '</select><button class="btn small" type="submit">حفظ</button></form>' : esc(L.treat[s.treatment]); } },
      { h: 'ملاحظة', wrap: 1, f: function (s) { return s.note || ''; } }], S.statuses) + '</div>';
  }
  async function sUsers(b) {
    var us = await sel(S.sb.from('ps_profiles').select('*').order('created_at', { ascending: false }));
    b.innerHTML = '<div class="panel"><h3>المستخدمون</h3><p class="note">المدير التنفيذي والمالية يسجلان حسابيهما بأنفسهما ثم تفعّلهما هنا. لا يمكنك تفعيل نفسك كمعتمِد للعمولة.</p>' + table([
      { h: 'الاسم', f: function (u) { return u.full_name || u.username; } }, { h: 'المستخدم', f: function (u) { return u.username; } },
      { h: 'الدور', raw: 1, f: function (u) { return '<form class="row" data-submit="user" data-id="' + u.id + '"><select name="role">' + Object.keys(L.role).map(function (k) { return '<option value="' + k + '"' + (u.role === k ? ' selected' : '') + '>' + L.role[k] + '</option>'; }).join('') + '</select><select name="employee_id"><option value="">— موظف —</option>' + S.emps.map(function (e) { return '<option value="' + e.id + '"' + (u.employee_id === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select><select name="is_active"><option value="true"' + (u.is_active ? ' selected' : '') + '>فعّال</option><option value="false"' + (!u.is_active ? ' selected' : '') + '>موقوف</option></select><button class="btn small" type="submit">حفظ</button></form>'; } },
      { h: 'التسجيل', f: function (u) { return fmtD(u.created_at); } }], us) + '</div>';
  }
  async function sAudit(b) {
    var rows = await sel(S.sb.from('ps_audit_log').select('*').order('changed_at', { ascending: false }).limit(200));
    b.innerHTML = '<div class="panel"><h3>آخر 200 عملية</h3>' + table([{ h: 'الوقت', f: function (r) { return fmtDT(r.changed_at); } }, { h: 'الجدول', f: function (r) { return r.table_name; } }, { h: 'العملية', f: function (r) { return r.action; } }, { h: 'المعرّف', f: function (r) { return r.record_id || ''; } }, { h: 'بواسطة', f: function (r) { return userName(r.changed_by); } }], rows) + '</div>';
  }

  /* ---------- actions ---------- */
  function val(form, n) { var el = form.elements[n]; return el ? el.value : ''; }
  async function busy(btn, fn) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { if (btn && btn.isConnected) btn.disabled = false; } }
  var A = {
    logout: async function () { await S.sb.auth.signOut(); },
    'dlg-close': closeDlg,
    sub: function (el) { S.sub = el.dataset.s; render(); },
    'order-detail': function (el) { orderDetail(el.dataset.id); },
    'order-new': orderNewForm,
    'orders-more': async function (el) { await busy(el, async function () { S.ordersPage++; var r = await fetchOrders(S.ordersPage); S.orderRows = S.orderRows.concat(r.data || []); $('#oTable').innerHTML = orderRowsHtml(S.orderRows); $('#oCount').textContent = num(S.ordersTotal) + ' طلب — المعروض ' + num(S.orderRows.length); if (S.orderRows.length >= S.ordersTotal) el.remove(); }); },
    'exp-orders': function () { exportXlsx('الطلبات-' + S.month.slice(0, 7), S.orderRows.map(function (o) { return { 'رقم الطلب': o.salla_order_id, 'المرجع': o.reference_id, 'تاريخ التوصيل': fmtDT(o.delivered_at), 'الحالة': o.current_status, 'الموظف': empName(o.employee_id), 'الكود': o.coupon_code, 'دليل التحقق': L.basis[o.attribution_basis], 'الصافي': Number(o.net_value), 'المرتجع': Number(o.returned_value), 'المراجعة': L.review[o.review_status], 'المصدر': L.src[o.import_source] }; })); },
    'exp-dash': function () { exportXlsx('الأداء-' + S.month.slice(0, 7), (S._dash || []).map(function (r) { return { 'الموظف': r.employee_name, 'الطلبات': r.orders_count, 'المحقق': Number(r.eligible_value), 'الهدف': r.target == null ? null : Number(r.target), 'التحقيق': r.achievement == null ? null : Number(r.achievement), 'العمولة': Number(r.commission) }; })); },
    'exp-comm': function () { exportXlsx('كشف-العمولات-' + S.month.slice(0, 7), (S._comm || []).map(function (r) { return { 'الموظف': r.employee_name, 'الطلبات': r.orders_count, 'المحقق': Number(r.eligible_value), 'الهدف': r.target == null ? null : Number(r.target), 'التحقيق': r.achievement == null ? null : Number(r.achievement), 'العمولة': Number(r.commission), 'تسويات المرتجع': Number(r.adjustments), 'رصيد مرحل': Number(r.carry_in), 'الصافي المستحق': Number(r.net_payable), 'يرحل': Number(r.carry_out), 'الحالة': L.run[r.status] }; })); },
    'exp-daily': function () { exportXlsx('التسجيل-اليومي', (S._daily || []).map(function (r) { return { 'التاريخ': r.log_date, 'الموظف': empName(r.employee_id), 'مسند': r.assigned_customers, 'تواصل': r.contacted, 'تحويل': r.converted, 'طلبات': r.orders_count, 'القيمة': Number(r.value), 'القناة': r.channel, 'ملاحظات': r.notes }; })); },
    rv: function (el) { reviewForm(el.dataset.id, el.dataset.d); },
    gen: function (el) { busy(el, async function () { var n = await rpc('ps_generate_runs', { p_month: S.month }); toast('تم توليد ' + n + ' كشف', 'ok'); render(); }); },
    appr: function (el) { busy(el, async function () { await rpc('ps_approve_run', { p_month: S.month, p_stage: el.dataset.s, p_note: null }); toast('تم الاعتماد', 'ok'); render(); }); },
    rej: function () { openDlg('رفض / إعادة للمسودة', '<form class="form" id="dForm" data-submit="rej"><label>السبب (إلزامي)<textarea name="note" required></textarea></label><button class="btn bad" type="submit">تأكيد الرفض</button></form>'); },
    'comm-detail': function (el) { commDetail(el.dataset.id); },
    'tpl-orders': function () { downloadTemplate('orders'); }, 'tpl-daily': function () { downloadTemplate('daily'); },
    'do-import': function (el) { busy(el, function () { return doImport(el.dataset.k, el); }); },
    'plan-new': planForm, 'plan-view': function (el) { S.planSel = el.dataset.id; sTargets($('#subBody')); },
    'plan-req': function (el) { busy(el, async function () { await rpc('ps_decide_plan', { p_plan: el.dataset.id, p_decision: 'request', p_note: null }); toast('أُرسلت للمدير التنفيذي', 'ok'); render(); }); },
    'plan-dec': function (el) { busy(el, async function () { await rpc('ps_decide_plan', { p_plan: el.dataset.id, p_decision: el.dataset.d, p_note: null }); toast('تم', 'ok'); render(); }); },
    'plan-del': function (el) { if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'تأكيد الحذف؟'; return; } busy(el, async function () { var r = await S.sb.from('ps_target_plans').delete().eq('id', el.dataset.id); if (r.error) throw r.error; toast('حُذفت المسودة', 'ok'); render(); }); },
    'rule-new': ruleForm, 'tier-add': function () { addTier([0, 0, 0]); },
    'rule-req': function (el) { busy(el, async function () { await rpc('ps_decide_rule', { p_version: Number(el.dataset.v), p_decision: 'request', p_note: null }); toast('أُرسلت للمدير التنفيذي', 'ok'); render(); }); },
    'rule-dec': function (el) { busy(el, async function () { await rpc('ps_decide_rule', { p_version: Number(el.dataset.v), p_decision: el.dataset.d, p_note: null }); toast('تم', 'ok'); render(); }); },
    'confirm-rules': function (el) { var on = el.dataset.v === '1'; openDlg(on ? 'تأكيد القواعد كتابياً' : 'سحب التأكيد', '<form class="form" id="dForm" data-submit="confirm-rules" data-v="' + (on ? 1 : 0) + '"><label>مرجع التأكيد الكتابي (رقم/تاريخ/مستند)<input name="note" required></label><button class="btn primary" type="submit">حفظ</button></form>'); },
    'emp-new': function () { empForm(); }, 'emp-edit': function (el) { empForm(S.empById[el.dataset.id]); },
    'code-new': function () { codeForm(); }, 'code-edit': function (el) { codeForm((S._codes || []).find(function (c) { return c.id === el.dataset.id; })); }
  };
  var SUBMIT = {
    'order-new': async function (f) {
      var row = {}; ['salla_order_id', 'reference_id', 'current_status', 'subtotal', 'coupon_discount', 'special_discount', 'returned_value', 'coupon_code', 'selling_channel'].forEach(function (k) { row[k] = val(f, k); });
      ['order_created_at', 'delivered_at', 'returned_at'].forEach(function (k) { row[k] = dtLocal(val(f, k)); });
      var r = await rpc('ps_import_orders', { p_rows: [row], p_source: 'manual' });
      if (!r.ok) throw new Error(r.errors.map(function (e) { return e.msg; }).join(' | ')); toast('تم الحفظ' + (r.flagged ? ' — يوجد طلبات بحاجة مراجعة' : ''), 'ok'); closeDlg(); refreshFlags(); render();
    },
    review: async function (f) { var d = f.dataset.d; await rpc('ps_decide_review', { p_order: f.dataset.id, p_decision: d, p_note: val(f, 'note'), p_employee: d === 'assign' ? val(f, 'emp') : null }); toast('تم تسجيل القرار', 'ok'); closeDlg(); render(); },
    rej: async function (f) { await rpc('ps_reject_run', { p_month: S.month, p_note: val(f, 'note') }); toast('أُعيد الكشف للمسودة', 'ok'); closeDlg(); render(); },
    daily: async function (f) {
      var row = {}; ['log_date', 'employee', 'assigned_customers', 'contacted', 'converted', 'orders_count', 'value', 'channel', 'notes'].forEach(function (k) { row[k] = val(f, k); });
      var r = await rpc('ps_import_daily', { p_rows: [row] }); if (!r.ok) throw new Error(r.errors.map(function (e) { return e.msg; }).join(' | ')); toast('تم حفظ اليوم', 'ok'); render();
    },
    'plan-new': async function (f) {
      var ins = { label: val(f, 'label'), scenario: val(f, 'scenario'), annual_target: Number(val(f, 'annual_target')), method: val(f, 'method'), smoothing: Number(val(f, 'smoothing')), first_month: val(f, 'first_month'), last_month: val(f, 'last_month'), start_date: val(f, 'start_date') || null, status: 'draft' };
      if (ins.last_month < ins.first_month) throw new Error('آخر شهر قبل أول شهر');
      var r = await S.sb.from('ps_target_plans').insert(ins); if (r.error) throw r.error; toast('حُفظت المسودة', 'ok'); closeDlg(); render();
    },
    'rule-new': async function (f) {
      var tiers = $$('.tier', f).map(function (d) { return { from_pct: Number($('[name=f]', d).value) / 100, to_pct: Number($('[name=t]', d).value) / 100, rate: Number($('[name=r]', d).value) / 100 }; });
      if (!tiers.length) throw new Error('أضف شريحة واحدة على الأقل');
      for (var i = 0; i < tiers.length; i++) { if (!(tiers[i].to_pct > tiers[i].from_pct)) throw new Error('كل شريحة يجب أن تكون "إلى" أكبر من "من"'); }
      var mx = await sel(S.sb.from('ps_rule_versions').select('version').order('version', { ascending: false }).limit(1)); var nv = (mx[0] ? mx[0].version : 0) + 1;
      var r = await S.sb.from('ps_rule_versions').insert({ version: nv, effective_from: val(f, 'effective_from'), method: val(f, 'method'), over100: val(f, 'over100'), extra_rate: Number(val(f, 'extra_rate')), status: 'draft', note: val(f, 'note') || null }); if (r.error) throw r.error;
      var r2 = await S.sb.from('ps_commission_tiers').insert(tiers.map(function (t) { t.version = nv; return t; })); if (r2.error) throw r2.error;
      toast('حُفظت المسودة (نسخة ' + nv + ')', 'ok'); closeDlg(); render();
    },
    'confirm-rules': async function (f) { await rpc('ps_set_rules_confirmed', { p_value: f.dataset.v === '1', p_note: val(f, 'note') }); toast('تم', 'ok'); closeDlg(); await refreshFlags(); render(); },
    emp: async function (f) {
      var row = { name: val(f, 'name').trim(), share_weight: Number(val(f, 'share_weight')), start_date: val(f, 'start_date') || null, end_date: val(f, 'end_date') || null, confirm_status: val(f, 'confirm_status'), is_active: val(f, 'is_active') === 'true' };
      var q = f.dataset.id ? S.sb.from('ps_employees').update(row).eq('id', f.dataset.id) : S.sb.from('ps_employees').insert(row); var r = await q; if (r.error) throw r.error;
      var e = await S.sb.from('ps_employees').select('*').order('name'); S.emps = e.data || []; S.empById = {}; S.emps.forEach(function (x) { S.empById[x.id] = x; }); toast('تم الحفظ', 'ok'); closeDlg(); render();
    },
    code: async function (f) {
      var row = { code: val(f, 'code').trim(), employee_id: val(f, 'employee_id'), confirm_status: val(f, 'confirm_status'), is_active: val(f, 'is_active') === 'true' };
      var q = f.dataset.id ? S.sb.from('ps_discount_codes').update(row).eq('id', f.dataset.id) : S.sb.from('ps_discount_codes').insert(row); var r = await q; if (r.error) throw r.error; toast('تم الحفظ', 'ok'); closeDlg(); render();
    },
    setting: async function (f) { var raw = val(f, 'v').trim(); var v = raw === 'true' ? true : (raw === 'false' ? false : (isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw)); var r = await S.sb.from('ps_settings').update({ value: v }).eq('key', f.dataset.k); if (r.error) throw r.error; toast('تم الحفظ', 'ok'); render(); },
    status: async function (f) { var r = await S.sb.from('ps_status_map').update({ treatment: val(f, 't') }).eq('salla_status_slug', f.dataset.k); if (r.error) throw r.error; var st = await S.sb.from('ps_status_map').select('*').order('salla_status_name'); S.statuses = st.data || []; toast('تم الحفظ', 'ok'); },
    user: async function (f) { var r = await S.sb.from('ps_profiles').update({ role: val(f, 'role'), employee_id: val(f, 'employee_id') || null, is_active: val(f, 'is_active') === 'true' }).eq('id', f.dataset.id); if (r.error) throw r.error; toast('تم الحفظ', 'ok'); }
  };

  /* ---------- wiring ---------- */
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('#nav button'); if (nav) { location.hash = nav.dataset.v; return; }
    var t = e.target.closest('[data-act]'); if (!t) { if (e.target.id === 'dlg') closeDlg(); return; }
    var fn = A[t.dataset.act]; if (fn) { e.preventDefault(); fn(t, e); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.id === 'authForm') { e.preventDefault(); doAuth(); return; }
    if (f.id === 'oFilter') { e.preventDefault(); var o = orderFilters(); o.q = val(f, 'q').trim(); o.by = val(f, 'by'); o.emp = f.elements.emp ? f.elements.emp.value : ''; o.review = val(f, 'review'); o.basis = val(f, 'basis'); o.allm = f.elements.allm.checked; render(); return; }
    var k = f.dataset && f.dataset.submit; if (!k || !SUBMIT[k]) return; e.preventDefault();
    var btn = f.querySelector('button[type=submit]'); busy(btn, function () { return SUBMIT[k](f); });
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'monthSel') { S.month = e.target.value; try { localStorage.setItem('ps_month', S.month); } catch (x) { /* ignore */ } render(); }
    if (e.target.id === 'fOrders' && e.target.files[0]) onFile('orders', e.target.files[0]);
    if (e.target.id === 'fDaily' && e.target.files[0]) onFile('daily', e.target.files[0]);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#dlg').hidden) closeDlg(); });
  window.addEventListener('hashchange', function () { if (!$('#app').hidden) route(); });
  $$('[data-auth-tab]').forEach(function (b) { b.addEventListener('click', function () { var reg = b.dataset.authTab === 'register'; $$('[data-auth-tab]').forEach(function (x) { x.classList.toggle('on', x === b); }); $$('.reg-only').forEach(function (x) { x.hidden = !reg; }); $('#authBtn').textContent = reg ? 'إنشاء الحساب' : 'دخول'; $('#fPass').autocomplete = reg ? 'new-password' : 'current-password'; $('#authForm').dataset.mode = reg ? 'register' : 'login'; $('#authMsg').textContent = ''; }); });
  $('#waitRefresh').addEventListener('click', async function () { var r = await S.sb.auth.getSession(); if (r.data.session) enter(r.data.session.user); });
  async function doAuth() {
    var msg = $('#authMsg'); msg.textContent = ''; var reg = $('#authForm').dataset.mode === 'register'; var u = $('#fUser').value; var p = $('#fPass').value; var btn = $('#authBtn'); btn.disabled = true;
    try {
      if (u.indexOf('@') < 0 && !/^[A-Za-z0-9._-]{3,30}$/.test(u.trim())) throw new Error('اسم المستخدم: حروف إنجليزية وأرقام فقط (٣–٣٠ حرفاً) أو استخدم بريداً إلكترونياً');
      var email = toEmail(u);
      if (reg) { var s = await S.sb.auth.signUp({ email: email, password: p, options: { data: { full_name: $('#fName').value.trim() } } }); if (s.error) throw s.error; if (!s.data.session) throw new Error('تم إنشاء الحساب، لكن تأكيد البريد مفعّل في الإعدادات — راجع مدير النظام'); await enter(s.data.user); }
      else { var r = await S.sb.auth.signInWithPassword({ email: email, password: p }); if (r.error) throw new Error(/Invalid login/i.test(r.error.message) ? 'بيانات الدخول غير صحيحة' : r.error.message); await enter(r.data.user); }
    } catch (e) { msg.textContent = errText(e); } finally { btn.disabled = false; }
  }
  setInterval(function () { if (!document.hidden && S.profile && can('staff')) refreshFlags(); }, 60000);
  boot().catch(function (e) { console.error(e); $('#boot').textContent = 'تعذّر بدء التطبيق: ' + errText(e); });
})();

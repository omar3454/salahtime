/* SalahTime city page logic — vanilla JS, zero backend.
 * Requires window.PrayTimes (assets/js/praytimes.js).
 * Reads city data from <body> data-attributes and renders:
 *  - today's prayer times card (computed live, never stale)
 *  - next-prayer countdown
 *  - full-year monthly timetable (precomputed 2026 JSON embedded in page,
 *    recomputed live when the calculation method / Asr setting changes)
 */
(function () {
  'use strict';

  var PT = window.PrayTimes;
  if (!PT) return;

  var body = document.body;
  var LAT = parseFloat(body.getAttribute('data-lat'));
  var LNG = parseFloat(body.getAttribute('data-lng'));
  var TZ = body.getAttribute('data-tz');
  var DEFAULT_METHOD = body.getAttribute('data-method') || 'MWL';
  var CITY = body.getAttribute('data-city') || '';
  var YEAR = 2026;

  var PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  var SALAT = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']; // real prayers (for the countdown)
  var LABELS = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  var method = DEFAULT_METHOD;
  var asrMode = 'Standard';
  var days = null; // [doy, fajr, sunrise, dhuhr, asr, maghrib, isha] in minutes
  var nextPrayer = null;

  /* ---------- helpers ---------- */

  function toMin(t) { return (t == null || isNaN(t)) ? null : Math.round(t * 60); }

  function fmtMin(mins) {
    if (mins == null || isNaN(mins)) return '--:--';
    var t = Math.round(mins);
    var h = Math.floor(t / 60) % 24, m = ((t % 60) + 60) % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
  }

  // local calendar date (y/m/d) in the city's timezone for a UTC instant
  function cityDateParts(utcMs) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(utcMs));
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day };
  }

  function doyOf(y, m, d) {
    return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  }

  function monthLength(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // absolute UTC ms of a city-local prayer time on city date (y,m,d)
  function prayerUtcMs(y, m, d, mins) {
    var off = PT.zoneOffsetMinutes(TZ, y, m, d);
    return Date.UTC(y, m - 1, d) + mins * 60000 - off * 60000;
  }

  /* ---------- year timetable ---------- */

  function computeYear() {
    days = [];
    var leap = (YEAR % 4 === 0 && YEAR % 100 !== 0) || YEAR % 400 === 0;
    var n = leap ? 366 : 365;
    for (var i = 0; i < n; i++) {
      var dt = new Date(Date.UTC(YEAR, 0, 1) + i * 86400000);
      var t = PT.computeDay({
        lat: LAT, lng: LNG, tz: TZ,
        y: YEAR, m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
        method: method, asr: asrMode
      });
      days.push([i, toMin(t.fajr), toMin(t.sunrise), toMin(t.dhuhr),
                 toMin(t.asr), toMin(t.maghrib), toMin(t.isha)]);
    }
  }

  function loadTimetable() {
    var el = document.getElementById('timetable-2026');
    var ok = false;
    if (el) {
      try {
        var data = JSON.parse(el.textContent);
        if (data && data.year === YEAR && data.method === method &&
            data.asr === asrMode && data.days && data.days.length >= 365) {
          days = data.days;
          ok = true;
        }
      } catch (e) { /* fall through to computeYear */ }
    }
    if (!ok) computeYear();
  }

  /* ---------- today card + countdown ---------- */

  function renderToday() {
    var now = Date.now();
    var cd = cityDateParts(now);
    var t = PT.computeDay({
      lat: LAT, lng: LNG, tz: TZ, y: cd.y, m: cd.m, d: cd.d,
      method: method, asr: asrMode
    });
    var mins = {};
    PRAYERS.forEach(function (k) { mins[k] = toMin(t[k]); });

    var html = '';
    PRAYERS.forEach(function (k) {
      html += '<tr id="row-' + k + '"><th scope="row">' + LABELS[k] +
              '</th><td>' + fmtMin(mins[k]) + '</td></tr>';
    });
    var tbody = document.querySelector('#today-table tbody');
    if (tbody) tbody.innerHTML = html;

    var dateEl = document.getElementById('today-date');
    if (dateEl) {
      dateEl.textContent = new Intl.DateTimeFormat('ar-u-nu-latn', {
        timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date(now)) + (CITY ? ' · ' + CITY : '');
    }

    // next prayer (among the five obligatory prayers)
    var seq = [];
    SALAT.forEach(function (k) {
      if (mins[k] != null) seq.push({ name: k, utc: prayerUtcMs(cd.y, cd.m, cd.d, mins[k]) });
    });
    var next = null;
    for (var i = 0; i < seq.length; i++) {
      if (seq[i].utc > now + 1000) { next = seq[i]; break; }
    }
    if (!next && seq.length) {
      var ndt = new Date(Date.UTC(cd.y, cd.m - 1, cd.d) + 86400000);
      var ny = ndt.getUTCFullYear(), nm = ndt.getUTCMonth() + 1, nd = ndt.getUTCDate();
      var t2 = PT.computeDay({ lat: LAT, lng: LNG, tz: TZ, y: ny, m: nm, d: nd, method: method, asr: asrMode });
      var fm = toMin(t2.fajr);
      if (fm != null) next = { name: 'fajr', utc: prayerUtcMs(ny, nm, nd, fm), tomorrow: true };
    }
    if (next) setNextPrayer(next);
  }

  function setNextPrayer(next) {
    nextPrayer = next;
    SALAT.forEach(function (k) {
      var row = document.getElementById('row-' + k);
      if (row) row.classList.toggle('next', k === next.name && !next.tomorrow);
    });
    var nameEl = document.getElementById('next-name');
    if (nameEl) nameEl.textContent = LABELS[next.name] + (next.tomorrow ? ' (غدًا)' : '');
    tickCountdown();
  }

  function tickCountdown() {
    var el = document.getElementById('next-countdown');
    if (!el || !nextPrayer) return;
    var s = Math.max(0, Math.floor((nextPrayer.utc - Date.now()) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    el.textContent = h + ' س ' + (m < 10 ? '0' : '') + m + ' د ' +
                     (sec < 10 ? '0' : '') + sec + ' ث';
  }

  /* ---------- month table ---------- */

  function renderMonth() {
    var sel = document.getElementById('month-select');
    var mi = sel ? +sel.value : cityDateParts(Date.now()).m - 1;
    if (mi < 0 || mi > 11) mi = 0;
    var m = mi + 1;
    var n = monthLength(YEAR, m);
    var startDoy = doyOf(YEAR, m, 1);

    var html = '<thead><tr><th scope="col">التاريخ</th>';
    PRAYERS.forEach(function (k) { html += '<th scope="col">' + LABELS[k] + '</th>'; });
    html += '</tr></thead><tbody>';
    for (var d = 1; d <= n; d++) {
      var row = days[startDoy + d - 1];
      html += '<tr><td>' + d + ' ' + MONTHS_S[mi] + '</td>';
      for (var i = 1; i <= 6; i++) html += '<td>' + fmtMin(row[i]) + '</td>';
      html += '</tr>';
    }
    html += '</tbody>';
    var table = document.getElementById('month-table');
    if (table) table.innerHTML = html;

    // highlight today's row when viewing the current month
    var cd = cityDateParts(Date.now());
    if (cd.y === YEAR && cd.m === m) {
      var rows = table.querySelectorAll('tbody tr');
      if (rows[cd.d - 1]) rows[cd.d - 1].classList.add('today-row');
    }
  }

  /* ---------- method switcher ---------- */

  function methodNoteText(key, asrM) {
    var m = PT.METHODS[key] || PT.METHODS.MWL;
    var s = m.name + ' — الفجر ' + m.fajr + '°';
    s += m.ishaMin ? '، العشاء بعد المغرب بـ' + m.ishaMin + ' دقيقة' : '، العشاء ' + m.isha + '°';
    if (m.maghrib) s += '، المغرب بعد الغروب بـ' + m.maghrib + ' دقائق';
    s += '. العصر: ' + (asrM === 'Hanafi' ? 'حنفي (معامل الظل 2)' : 'قياسي (معامل الظل 1)') + '.';
    return s;
  }

  function refreshMethodUI() {
    var note = document.getElementById('method-note');
    if (note) note.textContent = 'الطريقة النشطة: ' + methodNoteText(method, asrMode);
    var todayNote = document.getElementById('today-method-note');
    if (todayNote) {
      var m = PT.METHODS[method] || PT.METHODS.MWL;
      todayNote.textContent = 'حُسبت بطريقة ' + m.name + '.';
    }
  }

  function onSettingsChanged() {
    computeYear();
    refreshMethodUI();
    renderMonth();
    renderToday();
  }

  function wireControls() {
    var monthSel = document.getElementById('month-select');
    if (monthSel) {
      monthSel.value = String(cityDateParts(Date.now()).m - 1);
      monthSel.addEventListener('change', renderMonth);
    }
    var methodSel = document.getElementById('method-select');
    if (methodSel) {
      methodSel.value = method;
      methodSel.addEventListener('change', function () {
        method = methodSel.value;
        onSettingsChanged();
      });
    }
    var asrSel = document.getElementById('asr-select');
    if (asrSel) {
      asrSel.value = asrMode;
      asrSel.addEventListener('change', function () {
        asrMode = asrSel.value;
        onSettingsChanged();
      });
    }
  }

  /* ---------- init ---------- */

  function init() {
    loadTimetable();
    wireControls();
    refreshMethodUI();
    renderMonth();
    renderToday();
    setInterval(function () {
      tickCountdown();
      // re-render the card at most once per minute so "today" rolls over correctly
      var now = Date.now();
      if (!init._last || now - init._last > 60000) {
        init._last = now;
        renderToday();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

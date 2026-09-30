/* SalahTime shared client logic — dependency-free (no PrayTimes dependency).
 * Used by index.html, qibla.html, hijri.html. */
(function (root) {
  'use strict';

  var KAABA = { lat: 21.4225, lng: 39.8262 };
  var ISLAMIC_FMT = null;
  try {
    ISLAMIC_FMT = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura', {
      day: 'numeric', month: 'numeric', year: 'numeric'
    });
  } catch (e) { ISLAMIC_FMT = null; }

  function dtr(d) { return d * Math.PI / 180; }
  function rtd(r) { return r * 180 / Math.PI; }
  function fixAngle(a) { a = a % 360; return a < 0 ? a + 360 : a; }

  /* ---------- Hijri helpers ---------- */
  function islamicSupported() { return !!ISLAMIC_FMT; }

  // {year, month, day} in the islamic-umalqura calendar, or null
  function getIslamicParts(date) {
    if (!ISLAMIC_FMT) return null;
    var parts = {};
    try {
      ISLAMIC_FMT.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) { return null; }
    var y = parseInt(parts.year, 10), m = parseInt(parts.month, 10), d = parseInt(parts.day, 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { year: y, month: m, day: d };
  }

  function formatHijri(date) {
    try {
      return new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(date);
    } catch (e) { return ''; }
  }

  function formatGregorian(date) {
    return new Intl.DateTimeFormat('ar-u-nu-latn', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  function islamicMonthName(year, month) {
    try {
      // 15th of the month, noon — safely inside the month
      var probe = islamicToGregorianApprox(year, month, 15);
      return new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura', { month: 'long' }).format(probe);
    } catch (e) { return 'Month ' + month; }
  }

  // Approximate gregorian date for an islamic Y/M/D by scanning from an estimate.
  // We walk from today; callers use this only for month-name probes and grid bounds
  // discovered by walking (see hijriMonthSpan), so it just needs to land in-month.
  function islamicToGregorianApprox(year, month, day) {
    var now = new Date();
    var cur = getIslamicParts(now);
    if (!cur) return now;
    // crude estimate: islamic year ~354.37 days
    var diffYears = year - cur.year;
    var est = new Date(now.getTime() + diffYears * 354.37 * 86400000);
    for (var i = 0; i < 800; i++) {
      var p = getIslamicParts(est);
      if (!p) break;
      if (p.year === year && p.month === month) {
        var dd = new Date(est);
        dd.setDate(dd.getDate() + (day - p.day));
        var p2 = getIslamicParts(dd);
        if (p2 && p2.year === year && p2.month === month) return dd;
        return est;
      }
      est = new Date(est.getTime() + (p.year < year || (p.year === year && p.month < month) ? 15 : -15) * 86400000);
    }
    return now;
  }

  // Walk gregorian days to find the first/last gregorian date of the islamic
  // month containing `date`. Returns {first: Date, last: Date, year, month}.
  function hijriMonthSpan(date) {
    var cur = getIslamicParts(date);
    if (!cur) return null;
    var first = new Date(date), last = new Date(date), d, p;
    d = new Date(date);
    for (var i = 0; i < 32; i++) {
      d = new Date(d.getTime() - 86400000);
      p = getIslamicParts(d);
      if (!p || p.month !== cur.month || p.year !== cur.year) break;
      first = new Date(d);
    }
    d = new Date(date);
    for (var j = 0; j < 32; j++) {
      d = new Date(d.getTime() + 86400000);
      p = getIslamicParts(d);
      if (!p || p.month !== cur.month || p.year !== cur.year) break;
      last = new Date(d);
    }
    return { first: first, last: last, year: cur.year, month: cur.month };
  }

  // Next occurrence of islamic (month, day) on/after today. Self-contained: no hardcoded dates.
  function findNextIslamic(month, day) {
    if (!ISLAMIC_FMT) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 0; i < 500; i++) {
      var d = new Date(today.getTime() + i * 86400000);
      var p = getIslamicParts(new Date(d.getTime() + 12 * 3600000)); // noon: DST-safe
      if (p && p.month === month && p.day === day) {
        return { date: d, daysAway: i, hijriYear: p.year };
      }
    }
    return null;
  }

  function holyDaysCountdowns() {
    return [
      { name: 'بداية رمضان', arabic: '1 رمضان', next: findNextIslamic(9, 1) },
      { name: 'عيد الفطر', arabic: '1 شوال', next: findNextIslamic(10, 1) },
      { name: 'عيد الأضحى', arabic: '10 ذو الحجة', next: findNextIslamic(12, 10) }
    ];
  }

  function daysAwayText(n) {
    if (n === null || n === undefined) return '—';
    if (n === 0) return 'اليوم';
    if (n === 1) return 'غدًا';
    if (n === 2) return 'يومان';
    if (n <= 10) return n + ' أيام';
    return n + ' يومًا';
  }

  /* ---------- Geo helpers ---------- */
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var a = dtr(lat2 - lat1) / 2, b = dtr(lng2 - lng1) / 2;
    var h = Math.sin(a) * Math.sin(a) +
            Math.cos(dtr(lat1)) * Math.cos(dtr(lat2)) * Math.sin(b) * Math.sin(b);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function nearestCity(lat, lng, cities) {
    var best = null, bestD = Infinity;
    cities.forEach(function (c) {
      var d = haversineKm(lat, lng, c.lat, c.lng);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best ? { city: best, km: bestD } : null;
  }

  // Qibla bearing in degrees clockwise from true north (great-circle).
  function qiblaBearing(lat, lng) {
    var dLng = dtr(KAABA.lng - lng);
    var y = Math.sin(dLng);
    var x = Math.cos(dtr(lat)) * Math.tan(dtr(KAABA.lat)) -
            Math.sin(dtr(lat)) * Math.cos(dLng);
    return fixAngle(rtd(Math.atan2(y, x)));
  }

  function distanceToKaabaKm(lat, lng) {
    return haversineKm(lat, lng, KAABA.lat, KAABA.lng);
  }

  /* ---------- Timezone helpers (dependency-free) ---------- */
  // Offset in minutes of IANA zone `tz` at the given UTC instant.
  function tzOffsetMinutes(tz, date) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    var parts = {};
    dtf.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      (+parts.hour) % 24, +parts.minute, +parts.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  // Convert a wall-clock time (hours float) on gregorian (y,m,d) in zone `tz` to a Date.
  function zonedTimeToDate(tz, y, m, d, hourFloat) {
    var totalMin = Math.round(hourFloat * 60);
    var hh = Math.floor(totalMin / 60) % 24, mm = totalMin % 60;
    var guess = Date.UTC(y, m - 1, d, hh, mm, 0);
    var off = 0;
    for (var i = 0; i < 3; i++) off = tzOffsetMinutes(tz, new Date(guess - off * 60000));
    return new Date(guess - off * 60000);
  }

  /* ---------- Data loading ---------- */
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function loadCities() { return fetchJSON('/ar/assets/js/cities.json'); }
  function loadCityMeta() { return fetchJSON('/ar/assets/js/cities-meta.json'); }

  /* ---------- Search autocomplete ---------- */
  function setupSearch(inputEl, resultsEl, cities, onPick) {
    if (!inputEl || !resultsEl) return;
    function close() { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; }
    inputEl.addEventListener('input', function () {
      var q = inputEl.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      var hits = [];
      for (var i = 0; i < cities.length && hits.length < 8; i++) {
        var c = cities[i];
        if ((c.name + ' ' + c.country).toLowerCase().indexOf(q) !== -1) hits.push(c);
      }
      resultsEl.innerHTML = '';
      if (!hits.length) {
        var none = document.createElement('div');
        none.className = 'muted'; none.style.padding = '9px 14px';
        none.textContent = 'لا توجد مدن مطابقة.';
        resultsEl.appendChild(none);
      } else {
        hits.forEach(function (c) {
          var a = document.createElement('a');
          a.href = '/ar/cities/' + c.slug + '.html';
          a.innerHTML = '';
          var name = document.createElement('span'); name.textContent = c.name + ', ' + c.country;
          var go = document.createElement('span'); go.className = 'muted'; go.textContent = '  ← مواقيت الصلاة';
          a.appendChild(name); a.appendChild(go);
          a.addEventListener('click', function () { if (onPick) onPick(c); });
          resultsEl.appendChild(a);
        });
      }
      resultsEl.classList.add('open');
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); inputEl.blur(); }
      if (e.key === 'Enter') {
        var first = resultsEl.querySelector('a');
        if (first) { e.preventDefault(); window.location.href = first.href; }
      }
    });
    document.addEventListener('click', function (e) {
      if (!resultsEl.contains(e.target) && e.target !== inputEl) close();
    });
    inputEl.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  root.SalahTimeApp = {
    KAABA: KAABA,
    islamicSupported: islamicSupported,
    getIslamicParts: getIslamicParts,
    formatHijri: formatHijri,
    formatGregorian: formatGregorian,
    islamicMonthName: islamicMonthName,
    hijriMonthSpan: hijriMonthSpan,
    findNextIslamic: findNextIslamic,
    holyDaysCountdowns: holyDaysCountdowns,
    daysAwayText: daysAwayText,
    haversineKm: haversineKm,
    nearestCity: nearestCity,
    qiblaBearing: qiblaBearing,
    distanceToKaabaKm: distanceToKaabaKm,
    tzOffsetMinutes: tzOffsetMinutes,
    zonedTimeToDate: zonedTimeToDate,
    loadCities: loadCities,
    loadCityMeta: loadCityMeta,
    setupSearch: setupSearch
  };
})(typeof window !== 'undefined' ? window : this);

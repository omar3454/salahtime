/* PrayTimes — prayer time calculation engine.
 * Standard solar-declination / equation-of-time algorithm (public-domain math,
 * same formulation as the classic praytimes.org implementation), verified
 * against the Aladhan API (see verify.js). Works in Node and the browser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PrayTimes = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  var DMath = {
    dtr: function (d) { return (d * Math.PI) / 180.0; },
    rtd: function (r) { return (r * 180.0) / Math.PI; },
    sin: function (d) { return Math.sin(this.dtr(d)); },
    cos: function (d) { return Math.cos(this.dtr(d)); },
    tan: function (d) { return Math.tan(this.dtr(d)); },
    arcsin: function (x) { return this.rtd(Math.asin(x)); },
    arccos: function (x) { return this.rtd(Math.acos(x)); },
    arctan: function (x) { return this.rtd(Math.atan(x)); },
    arccot: function (x) { return this.rtd(Math.atan(1 / x)); },
    arctan2: function (y, x) { return this.rtd(Math.atan2(y, x)); },
    fixAngle: function (a) { return this.fix(a, 360); },
    fixHour: function (a) { return this.fix(a, 24); },
    fix: function (a, b) {
      a = a - b * Math.floor(a / b);
      return (a < 0) ? a + b : a;
    }
  };

  // Calculation methods: [fajrAngle, ishaAngle|'90 min', maghribAngle|'X min', ishaIsMinutes, imsakMinutes]
  var METHODS = {
    MWL:     { name: 'رابطة العالم الإسلامي',                  fajr: 18,   isha: 17,         maghrib: 0, ishaMin: 0,  imsak: 10 },
    ISNA:    { name: 'الجمعية الإسلامية لأمريكا الشمالية',      fajr: 15,   isha: 15,         maghrib: 0, ishaMin: 0,  imsak: 10 },
    EGYPT:   { name: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5,       maghrib: 0, ishaMin: 0,  imsak: 10 },
    MAKKAH:  { name: 'جامعة أم القرى، مكة المكرمة',       fajr: 18.5, isha: 90,         maghrib: 0, ishaMin: 90, imsak: 10 },
    KARACHI: { name: 'جامعة العلوم الإسلامية، كراتشي', fajr: 18, isha: 18,        maghrib: 0, ishaMin: 0,  imsak: 10 },
    KEMENAG: { name: 'وزارة الشؤون الدينية، إندونيسيا',           fajr: 20,   isha: 18,         maghrib: 0, ishaMin: 0,  imsak: 10 },
    JAKIM:   { name: 'دائرة التقدم الإسلامي، ماليزيا (جاكيم)', fajr: 20,   isha: 18,         maghrib: 0, ishaMin: 0,  imsak: 10 },
    MOROCCO: { name: 'وزارة الأوقاف والشؤون الإسلامية، المغرب',            fajr: 19,   isha: 17,         maghrib: 5, ishaMin: 0,  imsak: 10,
               offsets: { dhuhr: 5 } },
    JORDAN:  { name: 'وزارة الأوقاف، الأردن',              fajr: 18,   isha: 18,         maghrib: 5, ishaMin: 0,  imsak: 10 },
    FRANCE:  { name: 'اتحاد المنظمات الإسلامية في فرنسا',                           fajr: 12,   isha: 12,         maghrib: 0, ishaMin: 0,  imsak: 10 },
    // TURKEY offsets mirror Aladhan's Diyanet method definition (diyanet ihtiyat
    // precautionary adjustments, exposed in the API's meta.offset for method 13):
    TURKEY:  { name: 'رئاسة الشؤون الدينية، تركيا (ديانت)',                      fajr: 18,   isha: 17,         maghrib: 0, ishaMin: 0,  imsak: 10,
               offsets: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7, sunset: 7 } }
  };
  // Aladhan method ids that these correspond to (for verification)
  var ALADHAN_IDS = { MWL: 3, ISNA: 2, EGYPT: 5, MAKKAH: 4, KARACHI: 1, KEMENAG: 20, TURKEY: 13 };

  var RISE_SET_ANGLE = 0.833;   // sunrise/sunset angle (refraction)
  var ASR_STANDARD = 1, ASR_HANAFI = 2;

  function julianDate(year, month, day) {
    var y = year, m = month;
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
  }

  function sunPosition(jd) {
    var D = jd - 2451545.0;
    var g = DMath.fixAngle(357.529 + 0.98560028 * D);
    var q = DMath.fixAngle(280.459 + 0.98564736 * D);
    var L = DMath.fixAngle(q + 1.915 * DMath.sin(g) + 0.020 * DMath.sin(2 * g));
    var e = 23.439 - 0.00000036 * D;
    var RA = DMath.arctan2(DMath.cos(e) * DMath.sin(L), DMath.cos(L)) / 15;
    var decl = DMath.arcsin(DMath.sin(e) * DMath.sin(L));
    return { declination: decl, equation: q / 15 - DMath.fixHour(RA) };
  }

  // IANA timezone offset in minutes for a given UTC instant
  function tzOffsetMinutes(iana, date) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    var parts = {};
    dtf.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      (+parts.hour) % 24, +parts.minute, +parts.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  // Offset (minutes) of an IANA zone at local noon on (y, m, d) — DST-safe
  function zoneOffsetMinutes(iana, y, m, d) {
    var utc = Date.UTC(y, m - 1, d, 12, 0, 0), off = 0;
    for (var i = 0; i < 4; i++) {
      off = tzOffsetMinutes(iana, new Date(utc));
      utc = Date.UTC(y, m - 1, d, 12, 0, 0) - off * 60000;
    }
    return off;
  }

  function midDay(jd, t) {
    var eqt = sunPosition(jd + t).equation;
    return DMath.fixHour(12 - eqt);
  }

  function sunAngleTime(angle, lat, jd, t, direction) {
    var decl = sunPosition(jd + t).declination;
    var noon = midDay(jd, t);
    var tt = (1 / 15) * DMath.arccos(
      (-DMath.sin(angle) - DMath.sin(decl) * DMath.sin(lat)) /
      (DMath.cos(decl) * DMath.cos(lat))
    );
    return noon + (direction === 'ccw' ? -tt : tt);
  }

  function asrTime(factor, lat, jd, t) {
    var decl = sunPosition(jd + t).declination;
    var angle = -DMath.arccot(factor + DMath.tan(Math.abs(lat - decl)));
    return sunAngleTime(angle, lat, jd, t);
  }

  function timeDiff(t1, t2) { return DMath.fixHour(t2 - t1); }

  // AngleBased high-latitude adjustment (matches Aladhan default)
  function adjustHighLatitudes(times, method, lat) {
    var night = timeDiff(times.sunset, times.sunrise);
    var portion = function (angle) { return (angle / 60) * night; };
    // morning prayers: anchored to sunrise (ccw); evening prayers: anchored to sunset/maghrib
    var adjustCcw = function (name, base, angle) {
      var maxPortion = portion(angle);
      var diff = timeDiff(times[name], times[base]); // forward from prayer to base
      if (isNaN(times[name]) || diff > maxPortion) times[name] = times[base] - maxPortion;
    };
    var adjustCw = function (name, base, angle) {
      var maxPortion = portion(angle);
      var diff = timeDiff(times[base], times[name]); // forward from base to prayer
      if (isNaN(times[name]) || diff > maxPortion) times[name] = times[base] + maxPortion;
    };
    adjustCcw('imsak', 'sunrise', method.fajr);
    adjustCcw('fajr', 'sunrise', method.fajr);
    if (!method.ishaMin) adjustCw('isha', 'maghrib', method.isha);
    return times;
  }

  function computeDay(opts) {
    // opts: {lat, lng, tz (IANA), y, m, d, method, asr ('Standard'|'Hanafi')}
    var method = METHODS[opts.method] || METHODS.MWL;
    var asrFactor = (opts.asr === 'Hanafi') ? ASR_HANAFI : ASR_STANDARD;
    var lat = opts.lat, lng = opts.lng;
    var jd = julianDate(opts.y, opts.m, opts.d) - lng / (15 * 24);
    var tzHours = zoneOffsetMinutes(opts.tz, opts.y, opts.m, opts.d) / 60;

    var seeds = { imsak: 5, fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, maghrib: 18, isha: 18 };
    var times = {};
    Object.keys(seeds).forEach(function (k) { times[k] = seeds[k]; });

    for (var i = 0; i < 5; i++) {
      var p = {};
      Object.keys(times).forEach(function (k) { p[k] = times[k] / 24; });
      times.imsak = sunAngleTime(method.fajr, lat, jd, p.imsak, 'ccw') - method.imsak / 60;
      times.fajr = sunAngleTime(method.fajr, lat, jd, p.fajr, 'ccw');
      times.sunrise = sunAngleTime(RISE_SET_ANGLE, lat, jd, p.sunrise, 'ccw');
      times.dhuhr = midDay(jd, p.dhuhr);
      times.asr = asrTime(asrFactor, lat, jd, p.asr);
      times.sunset = sunAngleTime(RISE_SET_ANGLE, lat, jd, p.sunset);
      times.maghrib = times.sunset + method.maghrib / 60;
      times.isha = method.ishaMin
        ? times.maghrib + method.ishaMin / 60
        : sunAngleTime(method.isha, lat, jd, p.isha);
    }

    adjustHighLatitudes(times, method, lat);

    // midnight: average of sunset and next-day fajr/sunrise (Standard/Jafari)
    var jdNext = jd + 1;
    var nextFajr = sunAngleTime(method.fajr, lat, jdNext, times.fajr / 24, 'ccw');
    var nextSunrise = sunAngleTime(RISE_SET_ANGLE, lat, jdNext, times.sunrise / 24, 'ccw');
    times.midnight = times.sunset + timeDiff(times.sunset, nextSunrise) / 2;

    // convert local mean time -> zone time
    Object.keys(times).forEach(function (k) {
      times[k] = DMath.fixHour(times[k] + tzHours - lng / 15);
    });
    // method-specific minute offsets (e.g. Diyanet precautionary adjustments)
    if (method.offsets) Object.keys(method.offsets).forEach(function (k) {
      if (times[k] !== undefined) times[k] = DMath.fixHour(times[k] + method.offsets[k] / 60);
    });
    return times;
  }

  function fmt(t) {
    if (isNaN(t)) return '--:--';
    t = DMath.fixHour(t + 0.5 / 60); // round to nearest minute
    var h = Math.floor(t), m = Math.floor((t - h) * 60);
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
  }

  function qibla(lat, lng) {
    var kaabaLat = 21.4225, kaabaLng = 39.8262;
    var dLng = DMath.dtr(kaabaLng - lng);
    var y = Math.sin(dLng);
    var x = Math.cos(DMath.dtr(lat)) * Math.tan(DMath.dtr(kaabaLat)) -
            Math.sin(DMath.dtr(lat)) * Math.cos(dLng);
    return DMath.fixAngle(DMath.rtd(Math.atan2(y, x)));
  }

  return {
    METHODS: METHODS,
    ALADHAN_IDS: ALADHAN_IDS,
    computeDay: computeDay,
    fmt: fmt,
    qibla: qibla,
    zoneOffsetMinutes: zoneOffsetMinutes,
    sunPosition: sunPosition
  };
});

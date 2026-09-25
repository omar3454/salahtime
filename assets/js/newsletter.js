/* SalahTime newsletter — signup forms + slide-in popup.
 *
 * Subscriptions POST directly to the Brevo signup form endpoint below
 * (double opt-in: Brevo emails the subscriber a confirmation link).
 * No API key is exposed: list targeting is encoded in the endpoint URL.
 */
(function () {
  'use strict';

  var NEWSLETTER_ENDPOINT = 'https://8173fdcd.sibforms.com/serve/MUIFAPVh_8WSRbRMptvgLUD2ncNFqEaU_hlwXQ2UV_PdSHd9Wkt9TTAThLWvcDwtyDKjovtePE0ZL6LDb7lJZ64eRvg9YpP8Rr4PGMczEJ9gtHE-9eTvNcc75FtCeAbU6V5MVUbNBUmGgvSUVwbszQgn0pQ3gg7VjyWiL0Yf-PmiSJPfFjYiGccAqF99CN0eQL-uUP9qaM8DRYo52w==';
  var CITY_FIELD = 'CITY'; // Brevo contact attribute for the subscriber's city

  var LS_SUB = 'st_nl_subscribed';
  var LS_DISMISS = 'st_nl_dismissed';
  var DISMISS_DAYS = 30;

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
  }

  /* ---- City dropdowns ---- */
  function fillCitySelects() {
    var selects = $all('select[data-nl-cities]');
    if (!selects.length) return;
    fetch('/assets/js/cities.json')
      .then(function (r) { return r.json(); })
      .then(function (cities) {
        cities.sort(function (a, b) { return a.name.localeCompare(b.name); });
        selects.forEach(function (sel) {
          cities.forEach(function (c) {
            var o = document.createElement('option');
            o.value = c.slug;
            o.textContent = c.name + ', ' + c.country;
            sel.appendChild(o);
          });
          // Pre-select the visitor's saved city if there is one.
          try {
            var saved = JSON.parse(localStorage.getItem('salahtime') || '{}');
            if (saved.slug) sel.value = saved.slug;
          } catch (e) {}
        });
      })
      .catch(function () { /* city stays optional */ });
  }

  /* ---- Form handling ---- */
  function bindForms() {
    $all('form[data-nl-form]').forEach(function (form) {
      var email = $('input[type="email"]', form);
      var citySel = $('select[data-nl-cities]', form);
      var btn = $('button[type="submit"]', form);
      var doneBox = $('.nl-done', form.parentElement || document);
      var soonBox = $('.nl-soon', form.parentElement || document);

      // Already subscribed on this device: show the confirmation state.
      if (getLS(LS_SUB) && doneBox) {
        form.style.display = 'none';
        doneBox.classList.add('show');
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var addr = email.value.trim();
        if (!validEmail(addr)) {
          email.focus();
          email.setAttribute('aria-invalid', 'true');
          return;
        }
        email.removeAttribute('aria-invalid');

        if (!NEWSLETTER_ENDPOINT) {
          if (soonBox) soonBox.classList.add('show');
          return;
        }

        btn.disabled = true;

        // Brevo signup form payload (field names from the form's embed code).
        var body = new URLSearchParams();
        body.append('EMAIL', addr);
        if (citySel && citySel.value && CITY_FIELD) body.append(CITY_FIELD, citySel.value);
        body.append('email_address_check', ''); // honeypot: must stay empty
        body.append('locale', 'en');

        // no-cors: sibforms doesn't allow reading the response cross-origin;
        // a resolved promise means the subscription was accepted.
        fetch(NEWSLETTER_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        }).then(function () {
          onSubscribed(form, doneBox);
        }).catch(function () {
          btn.disabled = false;
          if (soonBox) {
            soonBox.textContent = 'Something went wrong — please try again in a moment.';
            soonBox.classList.add('show');
          }
        });
      });
    });
  }

  function onSubscribed(form, doneBox) {
    setLS(LS_SUB, '1');
    form.style.display = 'none';
    if (doneBox) doneBox.classList.add('show');
    var slide = $('#nl-slidein');
    if (slide) setTimeout(function () { slide.classList.remove('show'); }, 4000);
  }

  /* ---- Slide-in popup ---- */
  function initSlidein() {
    var slide = $('#nl-slidein');
    if (!slide) return;
    if (getLS(LS_SUB)) return; // already subscribed

    var dismissedAt = parseInt(getLS(LS_DISMISS) || '0', 10);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 864e5) return;

    var start = Date.now();
    var maxScroll = 0;
    var shown = false;

    function maybeShow() {
      if (shown) return;
      var elapsed = Date.now() - start;
      if ((elapsed > 45000) || (maxScroll > 55 && elapsed > 15000)) {
        shown = true;
        slide.classList.add('show');
        var input = $('input[type="email"]', slide);
        if (input) input.focus({ preventScroll: true });
        window.removeEventListener('scroll', onScroll, { passive: true });
      }
    }
    function onScroll() {
      var h = document.documentElement;
      var pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
      if (pct > maxScroll) maxScroll = pct;
      maybeShow();
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    var timer = setInterval(function () {
      maybeShow();
      if (shown) clearInterval(timer);
    }, 5000);

    function dismiss() {
      slide.classList.remove('show');
      setLS(LS_DISMISS, String(Date.now()));
    }
    var close = $('.nl-close', slide);
    if (close) close.addEventListener('click', dismiss);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && slide.classList.contains('show')) dismiss();
    });
  }

  function init() {
    fillCitySelects();
    bindForms();
    initSlidein();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

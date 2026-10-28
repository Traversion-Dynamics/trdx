/* Traversion Dynamics: contact form.
   The form posts JSON to this site's own /api/contact endpoint (see api/contact.js and
   lib/contact.js). The static build (scripts/build.js) points data-endpoint at FormSubmit
   instead, since a static host has no server to send mail. */
(function () {
  'use strict';

  var form = document.getElementById('contactForm');
  if (!form) { return; }

  var endpoint = form.getAttribute('data-endpoint') || '/api/contact';
  var external = /^https?:\/\//.test(endpoint);
  var MIN_FILL_MS = 1500;
  var sent = document.getElementById('sent');
  var again = document.getElementById('sentAgain');
  var statusEl = document.getElementById('formStatus');
  var submitBtn = document.getElementById('submitBtn');
  var submitLabel = submitBtn.querySelector('.btn__label');
  var openedAt = Date.now();
  var busy = false;

  var NAMES = ['name', 'email', 'organization', 'role', 'topic', 'message', 'consent'];
  var EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;

  function control(name) { return form.querySelector('[name="' + name + '"]'); }
  function fieldOf(name) { return control(name).closest('.field'); }
  function errorEl(name) { return document.getElementById('err-' + name); }

  /* preselect the topic from ?topic=... (only values that exist in the list) */
  var preset = new URLSearchParams(window.location.search).get('topic');
  if (preset) {
    var select = control('topic');
    var known = Array.prototype.some.call(select.options, function (o) { return o.value === preset; });
    if (known) { select.value = preset; }
  }

  function setError(name, message) {
    var input = control(name);
    var holder = errorEl(name);
    fieldOf(name).classList.toggle('has-error', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (holder) { holder.textContent = message || ''; }
  }

  function clearErrors() { NAMES.forEach(function (n) { setError(n, ''); }); }

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add('is-shown');
  }

  function hideStatus() {
    statusEl.textContent = '';
    statusEl.classList.remove('is-shown');
  }

  function value(name) { return control(name).value.trim(); }

  /* returns the first invalid control, or null. The server repeats every check. */
  function validate() {
    var first = null;
    function check(name, bad, message) {
      if (bad) { setError(name, message); if (!first) { first = control(name); } }
      else { setError(name, ''); }
    }
    check('name', value('name').length < 2, 'Please enter your name.');
    check('email', !EMAIL_RE.test(value('email')), 'Please enter a valid email address.');
    check('topic', !value('topic'), 'Please choose a topic.');
    check('message', value('message').length < 10, 'Please write at least a short message (10 characters).');
    check('consent', !control('consent').checked, 'Please confirm so we can reply to you.');
    return first;
  }

  /* clear a field's error as soon as the visitor fixes it */
  NAMES.forEach(function (name) {
    var input = control(name);
    var evt = (input.type === 'checkbox' || input.tagName === 'SELECT') ? 'change' : 'input';
    input.addEventListener(evt, function () {
      if (fieldOf(name).classList.contains('has-error')) { setError(name, ''); }
      hideStatus();
    });
  });

  function setBusy(on) {
    busy = on;
    submitBtn.disabled = on;
    form.setAttribute('aria-busy', on ? 'true' : 'false');
    submitLabel.textContent = on ? 'Sending...' : 'Send message';
  }

  function showSent() {
    form.reset();
    clearErrors();
    hideStatus();
    form.hidden = true;
    sent.hidden = false;
    sent.focus();
  }

  function externalPayload() {
    var topic = control('topic');
    var topicLabel = topic.options[topic.selectedIndex].text;
    return {
      name: value('name'),
      email: value('email'),
      organization: value('organization'),
      role: value('role'),
      topic: topicLabel,
      message: value('message'),
      _subject: 'Traversion Dynamics: ' + topicLabel + ' (' + value('name') + ')',
      _template: 'table',
      _captcha: 'false'
    };
  }

  function payload() {
    if (external) { return externalPayload(); }
    return {
      name: value('name'),
      email: value('email'),
      organization: value('organization'),
      role: value('role'),
      topic: value('topic'),
      message: value('message'),
      consent: control('consent').checked === true,
      website: control('website').value,
      elapsedMs: Date.now() - openedAt
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) { return; }
    hideStatus();

    var firstBad = validate();
    if (firstBad) { firstBad.focus(); return; }

    /* the server does these spam checks itself; FormSubmit cannot, so bots get a fake success here */
    if (external && (control('website').value !== '' || Date.now() - openedAt < MIN_FILL_MS)) {
      showSent();
      return;
    }

    setBusy(true);
    var controller = new AbortController();
    /* FormSubmit can take 30 seconds or more to answer */
    var timer = setTimeout(function () { controller.abort(); }, external ? 90000 : 20000);

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload()),
      signal: controller.signal
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        if (r.res.ok && (r.body.ok || String(r.body.success) === 'true')) { showSent(); return; }

        if (r.res.status === 400 && r.body.errors) {
          var first = null;
          Object.keys(r.body.errors).forEach(function (name) {
            if (NAMES.indexOf(name) !== -1) {
              setError(name, String(r.body.errors[name]));
              if (!first) { first = control(name); }
            }
          });
          if (first) { first.focus(); return; }
        }

        if (r.res.status === 429) {
          showStatus('Too many messages from this connection. Please wait a while and try again.');
          return;
        }
        showStatus('We could not send your message right now. Please try again in a moment.');
      })
      .catch(function () {
        showStatus('We could not reach the server. Check your connection and try again.');
      })
      .then(function () {
        clearTimeout(timer);
        setBusy(false);
      });
  });

  if (again) {
    again.addEventListener('click', function () {
      sent.hidden = true;
      form.hidden = false;
      openedAt = Date.now();
      control('name').focus();
    });
  }
})();

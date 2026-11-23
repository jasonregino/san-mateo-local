// San Mateo Local on-site forms (replaced the GoHighLevel embeds, 2026-11-22).
// Any <form class="w3" data-w3="form_name"> is sent to Web3Forms, which emails Jason.
//   data-name-field  field whose value is added to the email subject ("Claim: 3 Bees Coffee")
//   data-redirect    page to go to on success; data-carry lists fields to pass along,
//                    as "field=param" or just "field" (e.g. "organization,category")
//   data-done        id of the thank-you block to show instead (form is hidden)
// Fields whose name matches a URL parameter are prefilled from the link.
(function () {
  var q = new URLSearchParams(location.search);
  document.querySelectorAll('form.w3[data-w3]').forEach(function (f) {
    f.querySelectorAll('input[name],textarea[name],select[name]').forEach(function (el) {
      var v = q.get(el.name);
      if (v && el.type !== 'hidden' && !el.value) el.value = v;
      else if (v && el.type === 'hidden' && el.hasAttribute('data-from-url')) el.value = v;
    });
    var msg = f.querySelector('.w3-msg');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
      if (msg) msg.textContent = '';
      var data = {};
      new FormData(f).forEach(function (v, k) { data[k] = v; });
      var nf = f.getAttribute('data-name-field');
      if (nf && data[nf]) data.subject = (data.subject || 'San Mateo Local') + ': ' + data[nf];
      data.page = location.pathname;
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.success) throw new Error((j && j.message) || 'failed');
        try { gtag('event', 'lead_submit', { form_name: f.getAttribute('data-w3') }); } catch (_) {}
        var to = f.getAttribute('data-redirect');
        if (to) {
          var p = new URLSearchParams();
          (f.getAttribute('data-carry') || '').split(',').forEach(function (pair) {
            var kv = pair.trim().split('='), k = kv[0], name = kv[1] || kv[0];
            if (k && data[k]) p.set(name, data[k]);
          });
          location.href = to + (p.toString() ? '?' + p.toString() : '');
          return;
        }
        var done = document.getElementById(f.getAttribute('data-done'));
        if (done) { f.style.display = 'none'; done.hidden = false; done.scrollIntoView({ block: 'center' }); }
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (msg) msg.innerHTML = 'That didn’t go through. Please try again, or email <a href="mailto:jason@sanmateolocal.com">jason@sanmateolocal.com</a>.';
      });
    });
  });
})();

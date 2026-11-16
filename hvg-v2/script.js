// Hudson Valuation Group — script.js
document.querySelectorAll('[id="year"]').forEach(el => {
  el.textContent = new Date().getFullYear();
});
// Set current year in all year spans
document.querySelectorAll('.year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

// Inquiry source capture (first page of this visit). Stored in sessionStorage only;
// read by the contact form to fill its hidden source fields. No cookies, no third parties.
(function () {
  try {
    var KEY = 'hvg_src';
    if (sessionStorage.getItem(KEY)) return;
    var p = new URLSearchParams(location.search);
    var src = { landing_page: location.href.slice(0, 500), referrer: (document.referrer || '').slice(0, 500) };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'].forEach(function (k) {
      var v = p.get(k);
      if (v) src[k] = v.slice(0, 200);
    });
    sessionStorage.setItem(KEY, JSON.stringify(src));
  } catch (e) {}
})();

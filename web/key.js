// Get-your-key page: sends the order number and email to /api/licence-key and shows the key it returns.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PLAN_NAMES = { monthly: 'Monthly', pro: 'Pro (yearly)', lifetime: 'Lifetime' };
  $('keyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var order = $('kOrder').value.trim(), email = $('kEmail').value.trim();
    if (!order || !email) { $('kMsg').textContent = 'Enter both your order number and email.'; return; }
    $('kGo').disabled = true; $('kMsg').textContent = 'Checking your order…';
    fetch('/api/licence-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: order, email: email }) })
      .then(function (r) { return r.json().catch(function () { return { error: 'Something went wrong. Please try again.' }; }); })
      .then(function (d) {
        if (!d.key) { $('kMsg').textContent = d.error || 'Something went wrong. Please try again.'; return; }
        $('kMsg').textContent = '';
        $('kKey').value = d.key;
        $('kInfo').textContent = (PLAN_NAMES[d.plan] || d.plan) + (d.expires ? ' · valid until ' + d.expires : ' · never expires');
        $('kResult').hidden = false;
        $('kKey').select();
      }, function () { $('kMsg').textContent = 'Couldn\'t reach the key service. Check your connection and try again.'; })
      .then(function () { $('kGo').disabled = false; });
  });
  $('kCopy').addEventListener('click', function () {
    var done = function () { $('kCopy').textContent = 'Copied ✓'; setTimeout(function () { $('kCopy').textContent = 'Copy key'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText($('kKey').value).then(done, function () { $('kKey').select(); document.execCommand('copy'); done(); });
    else { $('kKey').select(); document.execCommand('copy'); done(); }
  });
})();

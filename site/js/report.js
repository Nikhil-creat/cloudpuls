(function () {
  var m = /[?&]id=([a-z2-7]{10})\b/.exec(location.search), id = m && m[1], who = document.getElementById('who'), msg = document.getElementById('msg'), go = document.getElementById('go');
  if (!id) { who.textContent = 'No app was specified.'; go.disabled = true; return; }
  who.textContent = 'App: ' + id;
  go.addEventListener('click', function () {
    go.disabled = true;
    fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function (r) { msg.textContent = r.ok ? 'Thank you. Your report was recorded.' : 'Could not record the report (' + r.status + ').'; })
      .catch(function () { msg.textContent = 'Network error. Please try again.'; go.disabled = false; });
  });
})();

/* Applies the saved light/dark choice before the page draws, to avoid a flash.
   The choice is kept only in this browser (never sent anywhere). */
(function () {
  try {
    var t = localStorage.getItem('trueref-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

(function () {
    var pref = localStorage.getItem('yagent-color-scheme') || 'system';
    var dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePref = pref === 'light' || pref === 'dark' ? pref : 'system';
})();

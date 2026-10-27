(function (global) {
    const KEY = 'yagent-color-scheme';
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    const listeners = new Set();

    function normalize(pref) {
        return pref === 'light' || pref === 'dark' ? pref : 'system';
    }

    function resolved(pref) {
        const mode = normalize(pref == null ? localStorage.getItem(KEY) || 'system' : pref);
        if (mode === 'light' || mode === 'dark') return mode;
        return systemDark.matches ? 'dark' : 'light';
    }

    function apply(pref) {
        const mode = normalize(pref);
        const theme = resolved(mode);
        document.documentElement.dataset.themePref = mode;
        document.documentElement.dataset.theme = theme;
        localStorage.setItem(KEY, mode);

        document.querySelectorAll('[data-theme-pref]').forEach(item => {
            item.setAttribute('aria-selected', item.dataset.themePref === mode ? 'true' : 'false');
        });

        const btn = document.querySelector('#theme .theme-btn');
        if (btn) {
            btn.setAttribute('aria-label', ({
                system: 'Theme: system',
                light: 'Theme: light',
                dark: 'Theme: dark',
            })[mode]);
        }

        listeners.forEach(fn => {
            try { fn(theme, mode); } catch (_) { /* ignore listener errors */ }
        });
        return mode;
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function closeTheme() {
        const root = document.getElementById('theme');
        if (!root) return;
        root.classList.remove('open');
        const btn = root.querySelector('.theme-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function mount() {
        apply(localStorage.getItem(KEY) || 'system');

        const themeRoot = document.getElementById('theme');
        if (!themeRoot) return;

        const themeBtn = themeRoot.querySelector('.theme-btn');
        const themeMenu = themeRoot.querySelector('.menu-panel');
        const langRoot = document.getElementById('lang');
        const langBtn = langRoot && langRoot.querySelector('.lang-btn');

        function openTheme() {
            if (langRoot) {
                langRoot.classList.remove('open');
                if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
            }
            themeRoot.classList.add('open');
            themeBtn.setAttribute('aria-expanded', 'true');
            const current = themeMenu.querySelector('[aria-selected="true"]');
            (current || themeMenu.firstElementChild).focus();
        }

        themeBtn.addEventListener('click', () => {
            if (themeRoot.classList.contains('open')) closeTheme();
            else openTheme();
        });

        if (langBtn) {
            langBtn.addEventListener('click', closeTheme, true);
        }

        themeMenu.addEventListener('click', e => {
            const item = e.target.closest('[data-theme-pref]');
            if (!item) return;
            apply(item.dataset.themePref);
            closeTheme();
            themeBtn.focus();
        });

        document.addEventListener('click', e => {
            if (!themeRoot.contains(e.target)) closeTheme();
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeTheme();
                return;
            }
            if (!themeRoot.classList.contains('open')) return;
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...themeMenu.querySelectorAll('[data-theme-pref]')];
            const at = items.indexOf(document.activeElement);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            items[(at + step + items.length) % items.length].focus();
        });

        systemDark.addEventListener('change', () => {
            if ((localStorage.getItem(KEY) || 'system') === 'system') apply('system');
        });
    }

    global.YagentTheme = { KEY, apply, resolved, onChange, mount, closeTheme };
})(window);

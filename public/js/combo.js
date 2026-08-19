/* Searchable dropdown, progressive enhancement. The server renders a real
   control that works with JS off:
     data-combo="select" → a native <select> (fixed choices, e.g. category)
     data-combo="free"   → a text <input> + <datalist> (free text + suggestions)
   This turns either into a filterable, scrollable listbox and keeps the
   underlying control as the value the form actually submits. No inline script
   (CSP), loaded with defer. */
(() => {
  const wraps = document.querySelectorAll('[data-combo]');
  wraps.forEach(setup);

  function setup(wrap) {
    const mode = wrap.getAttribute('data-combo'); // 'select' | 'free'
    let placeholder = wrap.getAttribute('data-placeholder') || '';
    let submit; // element carrying the form value
    let search; // visible text input
    let options = []; // [{ value, label }]

    if (mode === 'select') {
      const select = wrap.querySelector('select');
      if (!select) return;
      const empty = [...select.options].find((o) => o.value === '');
      if (empty && !placeholder) placeholder = empty.textContent.trim();
      options = [...select.options]
        .filter((o) => o.value !== '')
        .map((o) => ({ value: o.value, label: o.textContent.trim() }));
      select.setAttribute('tabindex', '-1');
      select.setAttribute('aria-hidden', 'true');
      select.style.display = 'none';
      submit = select;

      search = document.createElement('input');
      search.type = 'text';
      search.className = 'combo-search';
      search.autocomplete = 'off';
      search.placeholder = placeholder;
      const cur = options.find((o) => o.value === submit.value);
      if (cur) search.value = cur.label;
      wrap.appendChild(search);
    } else {
      const input = wrap.querySelector('input');
      if (!input) return;
      const listId = input.getAttribute('list');
      const dl = listId && document.getElementById(listId);
      if (dl) {
        options = [...dl.querySelectorAll('option')].map((o) => ({
          value: o.value,
          label: o.value,
        }));
        input.removeAttribute('list'); // drop the native datalist UI
        dl.remove();
      }
      if (!placeholder) placeholder = input.getAttribute('placeholder') || '';
      input.classList.add('combo-search');
      submit = input;
      search = input;
    }

    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');

    const list = document.createElement('ul');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);

    let shown = [];
    let active = -1;

    function render(q) {
      const needle = (q || '').trim().toLowerCase();
      shown = needle
        ? options.filter((o) => o.label.toLowerCase().includes(needle))
        : options.slice();
      list.innerHTML = '';
      shown.forEach((o) => {
        const li = document.createElement('li');
        li.className = 'combo-opt';
        li.setAttribute('role', 'option');
        li.textContent = o.label;
        // mousedown fires before blur, so the pick lands before the list closes
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(o);
        });
        list.appendChild(li);
      });
      if (shown.length === 0) {
        const li = document.createElement('li');
        li.className = 'combo-empty';
        li.textContent = mode === 'free' ? 'no match, your text is used as is' : 'no match';
        list.appendChild(li);
      }
      active = -1;
    }

    function open(q) {
      render(q);
      list.hidden = false;
      search.setAttribute('aria-expanded', 'true');
    }
    function close() {
      list.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function setActive(i) {
      const items = [...list.querySelectorAll('.combo-opt')];
      items.forEach((el) => el.classList.remove('active'));
      if (i >= 0 && i < items.length) {
        items[i].classList.add('active');
        items[i].scrollIntoView({ block: 'nearest' });
      }
      active = i;
    }
    function choose(o) {
      if (mode === 'select') {
        submit.value = o.value;
        search.value = o.label;
      } else {
        submit.value = o.value;
      }
      close();
    }

    search.addEventListener('focus', () => open(mode === 'free' ? search.value : ''));
    search.addEventListener('click', () => open(mode === 'free' ? search.value : ''));
    search.addEventListener('input', () => {
      if (mode === 'select') submit.value = ''; // typing clears the pick until re-chosen
      open(search.value);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) open(mode === 'free' ? search.value : '');
        setActive(Math.min(active + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0 && shown[active]) {
          e.preventDefault();
          choose(shown[active]);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });
    search.addEventListener('blur', () => setTimeout(close, 120));
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });
  }
})();

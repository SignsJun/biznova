export function renderCatalog(section, { attrs, head, image, placeholder, escape }) {
  const { items = [], currency, detailLayout = 'split' } = section;
  const categories = [...new Set(items.map(item => item.category))];
  const money = currency && new Intl.NumberFormat('en', { style: 'currency', currency });
  return `<section ${attrs} data-catalog data-currency="${currency || ''}">
    ${head}
    <div class="catalog-controls">
      <label>Search products<input type="search" data-search placeholder="Find a product"></label>
      <label>Category<select data-category><option value="">All categories</option>${categories.map(category => `<option>${escape(category)}</option>`).join('')}</select></label>
      ${currency ? `<label>Sort by<select data-sort><option value="">Featured</option><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option></select></label><button class="catalog-bag" type="button" data-open-bag>Shopping bag <span data-bag-count>0</span></button>` : ''}
    </div>
    <p class="catalog-count" data-results aria-live="polite"></p>
    <div class="catalog-grid">${items.map((item,index) => `<article class="catalog-product" data-product="${escape(item.sku)}" data-category-name="${escape(item.category)}" data-price="${item.priceCents ?? ''}">
      ${item.media || placeholder ? `<button type="button" class="catalog-media" data-details aria-label="View ${escape(item.title)} details">${item.media ? image(item.media) : placeholder(index)}</button>` : ''}
      <div class="catalog-copy"><p data-product-category>${escape(item.category)}</p><h3 data-product-title>${escape(item.title)}</h3>
      ${item.label && item.label.trim().toLowerCase() !== item.category.trim().toLowerCase() ? `<p data-product-label>${escape(item.label)}</p>` : ''}
      ${money ? `<p class="catalog-price">${escape(money.format(item.priceCents / 100))}</p>` : ''}
      <p data-product-body hidden>${escape(item.body || '')}</p>
      <div class="catalog-actions"><button type="button" data-details>View details</button>${money ? '<button type="button" data-add>Add to bag</button>' : ''}</div></div>
    </article>`).join('')}</div>
    <p class="catalog-empty" data-empty hidden>No products match your search.</p>
    <p class="catalog-count" data-status aria-live="polite"></p>
    <dialog class="catalog-dialog" aria-label="Product details"><button type="button" class="catalog-close" data-close aria-label="Close product details">×</button><div class="catalog-detail layout-${detailLayout}" data-detail-content></div>${money ? '<button type="button" class="button-primary" data-add-detail>Add to bag</button>' : ''}</dialog>
    ${money ? '<dialog class="catalog-dialog" aria-label="Shopping bag"><button type="button" class="catalog-close" data-close aria-label="Close shopping bag">×</button><h2>Shopping bag</h2><div data-bag-lines></div><p class="catalog-total" data-total></p><p>Local order preview.</p></dialog>' : ''}
  </section>`;
}

// This function runs in the generated site. Keep it independent of Node and of
// the Studio so that the exported store works on its own.
export function initCatalogs({ preview, projectId, page }) {
  for (const section of document.querySelectorAll('[data-catalog]')) {
    const find = selector => section.querySelector(selector);
    const cards = [...section.querySelectorAll('[data-product]')];
    const grid = find('.catalog-grid');
    const search = find('[data-search]');
    const category = find('[data-category]');
    const sort = find('[data-sort]');
    const details = find('[aria-label="Product details"]');
    const bag = find('[aria-label="Shopping bag"]');
    const storageKey = `biznova-bag:${page}:${section.id}`;
    const localKey = preview ? `${storageKey}:${projectId}` : storageKey;
    const price = card => Number(card.dataset.price);
    const name = card => card.querySelector('[data-product-title]').textContent;
    let selected;
    let quantities = Object.create(null);
    let bagEdited = false;
    const format = cents => new Intl.NumberFormat('en', { style: 'currency', currency: section.dataset.currency }).format(cents / 100);

    function filter() {
      const query = search.value.trim().toLowerCase();
      const ordered = [...cards];
      if (sort?.value) ordered.sort((a, b) => (sort.value === 'asc' ? 1 : -1) * (price(a) - price(b)));
      let count = 0;
      for (const card of ordered) {
        card.hidden = !(card.dataset.categoryName === category.value || !category.value) || !card.textContent.toLowerCase().includes(query);
        if (!card.hidden) count++;
        grid.append(card);
      }
      find('[data-empty]').hidden = count > 0;
      find('[data-results]').textContent = `${count} ${count === 1 ? 'product' : 'products'}`;
    }

    function receiveBag(value) {
      quantities = Object.assign(Object.create(null), Object.fromEntries(cards.flatMap(card => {
        const sku = card.dataset.product;
        const qty = value && Object.hasOwn(value, sku) ? value[sku] : 0;
        return Number.isInteger(qty) && qty > 0 && qty <= 99 ? [[sku, qty]] : [];
      })));
      showBag();
    }

    function setQuantity(card, qty) {
      bagEdited = true;
      const sku = card.dataset.product;
      if (qty > 0) quantities[sku] = Math.min(99, qty);
      else delete quantities[sku];
      try { localStorage.setItem(localKey, JSON.stringify(quantities)); } catch { /* Studio's sandbox uses its parent. */ }
      if (preview && parent !== window) parent.postMessage({ type: 'biznova:bag-save', projectId, storageKey, quantities }, '*');
      showBag();
    }

    function showBag() {
      if (!bag) return;
      const lines = find('[data-bag-lines]');
      lines.replaceChildren();
      let subtotal = 0;
      let count = 0;
      for (const card of cards) {
        const qty = quantities[card.dataset.product] || 0;
        if (!qty) continue;
        count += qty;
        subtotal += qty * price(card);
        const row = document.createElement('div');
        row.className = 'catalog-bag-line';
        const caption = document.createElement('span');
        caption.textContent = `${name(card)} · ${qty} × ${format(price(card))}`;
        row.append(caption);
        for (const [label, change] of [['Decrease', -1], ['Increase', 1]]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = change < 0 ? '−' : '+';
          button.setAttribute('aria-label', `${label} ${name(card)} quantity`);
          button.addEventListener('click', () => {
            setQuantity(card, qty + change);
            const next = [...lines.querySelectorAll('button')].find(control => control.getAttribute('aria-label') === `${label} ${name(card)} quantity`);
            (next || bag.querySelector('[data-close]')).focus();
          });
          row.append(button);
        }
        lines.append(row);
      }
      if (!count) lines.textContent = 'Your bag is empty.';
      find('[data-bag-count]').textContent = String(count);
      find('[data-total]').textContent = `Subtotal ${format(subtotal)}`;
    }

    function add(card) {
      setQuantity(card, (quantities[card.dataset.product] || 0) + 1);
      find('[data-status]').textContent = `${name(card)} added to your bag.`;
    }

    for (const card of cards) {
      for (const button of card.querySelectorAll('[data-details]')) button.addEventListener('click', () => {
        selected = card;
        const content = find('[data-detail-content]');
        const picture = card.querySelector('.catalog-media > :first-child')?.cloneNode(true);
        const copy = document.createElement('div');
        for (const selector of ['[data-product-category]', '[data-product-title]', '[data-product-label]', '.catalog-price', '[data-product-body]']) {
          const node = card.querySelector(selector)?.cloneNode(true);
          if (node) { node.hidden = false; copy.append(node); }
        }
        content.replaceChildren(...(picture ? [picture, copy] : [copy]));
        details.showModal();
      });
      card.querySelector('[data-add]')?.addEventListener('click', () => add(card));
    }
    find('[data-add-detail]')?.addEventListener('click', () => { add(selected); details.close(); });
    find('[data-open-bag]')?.addEventListener('click', () => bag.showModal());
    for (const button of section.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
    search.addEventListener('input', filter);
    category.addEventListener('change', filter);
    sort?.addEventListener('change', filter);
    filter();
    if (bag) {
      try { receiveBag(JSON.parse(localStorage.getItem(localKey))); } catch { showBag(); }
      if (preview && parent !== window) {
        window.addEventListener('message', event => {
          if (event.source === parent && event.data?.type === 'biznova:bag-state' && event.data.storageKey === storageKey && !bagEdited) receiveBag(event.data.quantities);
        });
        parent.postMessage({ type: 'biznova:bag-load', projectId, storageKey }, '*');
      }
    }
  }
}

export const catalogCss = `
.document-site .section-catalog{padding-top:clamp(30px,4vw,58px)}
.section-catalog .section-header{margin-bottom:10px}.section-catalog .section-header h2{font-size:clamp(29px,4vw,49px)}
.section-catalog .section-intro{margin-top:10px}
.catalog-controls{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:28px 0 10px}
.catalog-controls label{display:grid;gap:6px;font-weight:600}
.catalog-controls input,.catalog-controls select,.section-catalog button{font:inherit;color:var(--ink);border:1px solid var(--line);background:var(--bg);padding:9px 13px;border-radius:8px}
.catalog-controls input{width:100%;min-width:0}.catalog-controls label:first-child{flex:1 1 190px}
.catalog-bag span{display:inline-block;margin-left:4px;font-weight:700}.catalog-count{color:var(--muted);min-height:1.5em;margin:10px 0}
.catalog-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:25px}.layout-list .catalog-grid{grid-template-columns:1fr}
.catalog-product{min-width:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel);overflow-wrap:anywhere}
.catalog-product[hidden],.catalog-empty[hidden]{display:none}.section-catalog .catalog-media{display:block;width:100%;padding:0;border:0;border-radius:0}
.catalog-media img,.catalog-media>div{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.catalog-media>div{display:grid;align-items:center}.catalog-copy{padding:20px}.catalog-copy h3{font-size:clamp(19px,3vw,26px);line-height:1.13;margin:5px 0 9px}
.catalog-price,.catalog-total{font-weight:700;margin:9px 0}.catalog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.section-catalog :is([data-add],[data-add-detail]):hover,.section-catalog [data-open-bag]{background:var(--accent);color:var(--accent-ink)}
.catalog-dialog{position:fixed;inset:0;margin:auto;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:15px;padding:34px;width:min(720px,calc(100% - 32px));max-height:90vh;overflow:auto}
.catalog-dialog::backdrop{background:#101018a8}.section-catalog .catalog-close{position:absolute;top:8px;right:8px;font-size:21px;padding:2px 10px;z-index:1}
.catalog-dialog .button-primary{margin-top:18px}.catalog-dialog h2{padding-right:30px}
.catalog-detail{display:grid;gap:20px;align-items:center;overflow-wrap:anywhere}.catalog-detail.layout-split:has(>:nth-child(2)){grid-template-columns:1fr 1fr}
.catalog-detail img{width:100%;max-height:350px;object-fit:cover;border-radius:8px}.catalog-detail h3{font-size:clamp(23px,4vw,36px);line-height:1.1;margin:8px 0}
.catalog-bag-line{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
@media(min-width:701px){.layout-list .catalog-product:has(.catalog-media){display:grid;grid-template-columns:minmax(180px,32%) 1fr}.layout-list .catalog-product[hidden]{display:none}}
@media(max-width:900px){.catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}}
@media(max-width:520px){
 .catalog-grid,.catalog-detail.layout-split:has(>:nth-child(2)){grid-template-columns:1fr}
 .catalog-dialog{padding:28px 18px}
 .catalog-controls{display:grid;grid-template-columns:1fr 1fr}
 .catalog-controls label{min-width:0}.catalog-controls label:first-child,.catalog-bag{grid-column:1/-1}
 .catalog-controls :is(input,select){width:100%;min-width:0}
}
`;

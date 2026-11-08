'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Download, Droplets, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import { STORE_CATEGORIES, STORE_PRODUCTS, storePrice, type StoreCategory, type StoreProduct } from '@/lib/store-catalog';
import './storefront.css';

type Cart = Record<string, number>;
type StoreView = { type: 'product'; product: StoreProduct } | { type: 'bag' | 'checkout' };
type SortOrder = 'featured' | 'price-asc' | 'price-desc';
const BAG_KEY = 'biznova-store-bag-v1';
const MAX_QUANTITY = 12;

function readBag(): Cart {
  try {
    const stored = JSON.parse(localStorage.getItem(BAG_KEY) || '{}');
    return Object.fromEntries(STORE_PRODUCTS.flatMap(({ id }) => {
      const quantity = stored?.[id];
      return Number.isInteger(quantity) && quantity > 0 ? [[id, Math.min(quantity, MAX_QUANTITY)]] : [];
    }));
  } catch {
    return {};
  }
}

function StoreDialog({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`nova-dialog ${wide ? 'nova-dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="nova-dialog-inner">
        <header className="nova-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="nova-icon" aria-label="Close dialog" onClick={onClose}><X size={20}/></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function Quantity({ name, value, onChange }: { name: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="nova-quantity" role="group" aria-label={`Quantity for ${name}`}>
      <button aria-label={`Decrease ${name} quantity`} disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={15}/></button>
      <span>{value}</span>
      <button aria-label={`Increase ${name} quantity`} disabled={value >= MAX_QUANTITY} onClick={() => onChange(value + 1)}><Plus size={15}/></button>
    </div>
  );
}

export default function Storefront() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<StoreCategory>('All drinkware');
  const [sort, setSort] = useState<SortOrder>('featured');
  const [bag, setBag] = useState<Cart | null>(null);
  const [view, setView] = useState<StoreView | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const collectionHeading = useRef<HTMLHeadingElement>(null);
  const storyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { setBag(readBag()); }, []);
  useEffect(() => {
    if (!bag) return;
    try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* Keep the current bag available in memory. */ }
  }, [bag]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const query = search.trim().toLowerCase();
  const products = STORE_PRODUCTS.filter(product =>
    (category === 'All drinkware' || product.category === category) &&
    `${product.name} ${product.size} ${product.category} ${product.use}`.toLowerCase().includes(query)
  );
  if (sort !== 'featured') {
    products.sort((a, b) => sort === 'price-asc' ? a.priceCents - b.priceCents : b.priceCents - a.priceCents);
  }
  const lines = STORE_PRODUCTS.flatMap(product => {
    const count = bag?.[product.id] || 0;
    return count ? [{ product, count }] : [];
  });
  const itemCount = lines.reduce((sum, line) => sum + line.count, 0);
  const subtotal = lines.reduce((sum, { product, count }) => sum + product.priceCents * count, 0);

  const jumpTo = (heading: HTMLHeadingElement | null) => {
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  };

  const showProduct = (product: StoreProduct) => {
    setQuantity(1);
    setNotice('');
    setView({ type: 'product', product });
  };

  const addToBag = (product: StoreProduct, count = 1) => {
    if ((bag?.[product.id] || 0) + count > MAX_QUANTITY) {
      setNotice(`You can add up to ${MAX_QUANTITY} of each item.`);
      return;
    }
    setBag(current => ({ ...current, [product.id]: Math.min(MAX_QUANTITY, (current?.[product.id] || 0) + count) }));
    setNotice(`${product.name} added to your bag.`);
  };

  const updateLine = (id: string, count: number) => {
    setBag(current => {
      const next = { ...current };
      if (count === 0) delete next[id];
      else next[id] = count;
      return next;
    });
  };

  const downloadSummary = () => {
    const summary = [
      'NOVA HOME — Order preview',
      '',
      ...lines.map(({ product, count }) => `${count} × ${product.name} (${product.size}) — ${storePrice(product.priceCents * count)}`),
      '',
      `Merchandise subtotal: ${storePrice(subtotal)} USD`,
      'Shipping and tax are not included. This preview is not a placed order.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([summary], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nova-home-order-preview.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  };

  const close = () => { setView(null); setNotice(''); };

  return (
    <main className="main-content nova-store">
      <div className="nova-store-bar">
        <span className="nova-wordmark"><Droplets size={20} aria-hidden="true"/> NOVA HOME</span>
        <div className="nova-store-links">
          <button onClick={() => jumpTo(collectionHeading.current)}>Shop</button>
          <button onClick={() => jumpTo(storyHeading.current)}>Our story</button>
        </div>
        <button className="nova-bag-button" onClick={() => setView({ type: 'bag' })}>
          <ShoppingBag size={18} aria-hidden="true"/> Bag <span>{itemCount}</span>
        </button>
      </div>

      <section className="nova-hero" aria-labelledby="nova-hero-title">
        <div className="nova-hero-copy">
          <p className="nova-kicker">THE EVERYDAY COLLECTION <span>01 / DRINKWARE</span></p>
          <h1 id="nova-hero-title">Good drinks.<br/>Good days.</h1>
          <p>Considered bottles and cups for wherever your day takes you. From the first coffee to the last refill.</p>
          <button className="nova-primary" onClick={() => jumpTo(collectionHeading.current)}>Shop the collection <ArrowDown size={16}/></button>
        </div>
        <div className="nova-hero-media">
          <img src="/images/store/hero.webp" alt="A stainless steel flask on a dark surface with ice" fetchPriority="high"/>
        </div>
      </section>

      <section className="nova-collection" aria-labelledby="nova-collection">
        <div className="nova-section-heading">
          <div>
            <p className="nova-kicker">01 / THE COLLECTION</p>
            <h2 ref={collectionHeading} id="nova-collection" tabIndex={-1}>Find your daily carry.</h2>
          </div>
          <p>Choose a bottle for your refill routine, or a cup for a moment to slow down.</p>
        </div>
        <div className="nova-catalog-controls">
          <div className="nova-filters" aria-label="Filter by category">
            {STORE_CATEGORIES.map(option => (
              <button key={option} aria-pressed={category === option} onClick={() => setCategory(option)}>{option}</button>
            ))}
          </div>
          <div className="nova-catalog-inputs">
            <label className="nova-catalog-search">
              <Search size={15} aria-hidden="true"/>
              <input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search the collection" placeholder="Search drinkware"/>
            </label>
            <select aria-label="Sort products" value={sort} onChange={event => setSort(event.target.value as SortOrder)}>
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </div>
        </div>
        <p className="nova-results" aria-live="polite">{products.length} {products.length === 1 ? 'product' : 'products'} <span>USD</span></p>
        {products.length ? (
          <div className="nova-grid">
            {products.map(product => (
              <article className="nova-product" key={product.id}>
                <button className="nova-product-media" aria-label={`View ${product.name} details`} onClick={() => showProduct(product)}>
                  <img src={product.image} alt="" loading="lazy" decoding="async"/>
                  <span>{product.category}</span><ArrowUpRight size={18} aria-hidden="true"/>
                </button>
                <div className="nova-product-copy">
                  <div className="nova-product-heading">
                    <h3><button onClick={() => showProduct(product)}>{product.name}</button></h3>
                    <strong>{storePrice(product.priceCents)}</strong>
                  </div>
                  <p>{product.size} <span aria-hidden="true">·</span> {product.use}</p>
                  <button className="nova-product-add" onClick={() => addToBag(product)}><Plus size={16}/> Add to bag <span className="nova-sr-only">– {product.name}</span></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="nova-empty">
            <h3>No products match your search.</h3>
            <button className="nova-secondary" onClick={() => { setCategory('All drinkware'); setSearch(''); }}>Clear filters</button>
          </div>
        )}
      </section>

      <section className="nova-story" aria-labelledby="nova-story">
        <p className="nova-kicker">02 / OUR STORY</p>
        <div>
          <h2 ref={storyHeading} id="nova-story" tabIndex={-1}>Small rituals.<br/>Every day.</h2>
          <p>Nova Home is a drinkware collection built around the moments between things. A coffee before the commute. A water break on the way home. A bottle you reach for without thinking twice.</p>
          <button className="nova-text-button" onClick={() => jumpTo(collectionHeading.current)}>Explore the collection <ArrowUpRight size={15}/></button>
        </div>
      </section>

      <section className="nova-questions" aria-labelledby="nova-questions">
        <div><p className="nova-kicker">03 / GOOD TO KNOW</p><h2 id="nova-questions">Before you choose.</h2></div>
        <div>
          <details><summary>Which size should I pick?</summary><p>For a single coffee, start with the 350 mL Travel Cup. A 20–24 oz bottle suits shorter trips. Choose 32–40 oz when you want more water between refills.</p></details>
          <details><summary>What can I do with my bag?</summary><p>Add products, adjust quantities, and save a merchandise summary from the order review. Your bag is kept in this browser.</p></details>
          <details><summary>Are checkout and delivery available?</summary><p>The storefront currently supports an order preview. Payments, shipping, and taxes will be available when checkout opens.</p></details>
        </div>
      </section>

      <footer className="nova-footer">
        <span className="nova-wordmark"><Droplets size={18} aria-hidden="true"/> NOVA HOME</span>
        <span>Product reference imagery · Prices in USD</span>
        <button className="nova-text-button" onClick={() => jumpTo(collectionHeading.current)}>Back to collection <ArrowUpRight size={15}/></button>
      </footer>

      {!view && notice && <p className="nova-toast" role="status"><ShoppingBag size={17}/>{notice}</p>}
      {view?.type === 'product' && (
        <StoreDialog title={view.product.name} wide onClose={close}>
          <div className="nova-detail">
            <img src={view.product.image} alt={view.product.name}/>
            <div>
              <p className="nova-kicker">{view.product.category} · {view.product.size}</p>
              <p className="nova-detail-price">{storePrice(view.product.priceCents)}</p>
              <p className="nova-detail-description">{view.product.description}</p>
              <dl><dt>Capacity</dt><dd>{view.product.size}</dd><dt>Good for</dt><dd>{view.product.use}</dd></dl>
              <div className="nova-detail-actions">
                <Quantity name={view.product.name} value={quantity} onChange={setQuantity}/>
                <button className="nova-primary" onClick={() => addToBag(view.product, quantity)}>Add to bag <ShoppingBag size={16}/></button>
              </div>
              {itemCount > 0 && <button className="nova-text-button" onClick={() => { setNotice(''); setView({ type: 'bag' }); }}>View bag ({itemCount}) <ArrowRight size={15}/></button>}
              {notice && <p className="nova-dialog-notice" role="status">{notice}</p>}
            </div>
          </div>
        </StoreDialog>
      )}
      {view?.type === 'bag' && (
        <StoreDialog title={`Your bag (${itemCount})`} onClose={close}>
          {lines.length ? (
            <>
              <ul className="nova-cart-lines">
                {lines.map(({ product, count }) => (
                  <li key={product.id}>
                    <img src={product.image} alt=""/>
                    <div><strong>{product.name}</strong><p>{product.size} · {storePrice(product.priceCents)} each</p>
                      <div className="nova-line-actions"><Quantity name={product.name} value={count} onChange={value => updateLine(product.id, value)}/><button onClick={() => updateLine(product.id, 0)} aria-label={`Remove ${product.name}`}>Remove</button></div>
                    </div>
                    <strong>{storePrice(product.priceCents * count)}</strong>
                  </li>
                ))}
              </ul>
              <div className="nova-subtotal"><span>Subtotal</span><strong>{storePrice(subtotal)}</strong></div>
              <p className="nova-fineprint">Merchandise only · USD</p>
              <button className="nova-primary nova-full" onClick={() => { setDownloaded(false); setView({ type: 'checkout' }); }}>Review order <ArrowRight size={17}/></button>
            </>
          ) : (
            <div className="nova-empty"><ShoppingBag size={28}/><h3>Your bag is empty.</h3><button className="nova-secondary" onClick={close}>Continue shopping</button></div>
          )}
        </StoreDialog>
      )}
      {view?.type === 'checkout' && (
        <StoreDialog title="Order review" onClose={close}>
          <button className="nova-text-button" onClick={() => setView({ type: 'bag' })}><ArrowLeft size={15}/> Back to bag</button>
          <ul className="nova-order-lines">
            {lines.map(({ product, count }) => <li key={product.id}><span>{count} × {product.name} <small>{product.size}</small></span><strong>{storePrice(product.priceCents * count)}</strong></li>)}
          </ul>
          <div className="nova-subtotal"><span>Merchandise subtotal</span><strong>{storePrice(subtotal)} USD</strong></div>
          <p className="nova-fineprint">Order preview. You can download this summary. Payment, shipping, and taxes are pending launch.</p>
          <button className="nova-primary nova-full" onClick={downloadSummary}>Download order summary <Download size={17}/></button>
          {downloaded && <p className="nova-dialog-notice" role="status">Order summary downloaded.</p>}
        </StoreDialog>
      )}
    </main>
  );
}

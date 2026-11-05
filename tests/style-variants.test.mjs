import test from 'node:test';
import assert from 'node:assert/strict';
import {VARIANT_STYLE_IDS,renderStyleVariant} from '../local/site-style-variants.mjs';
import {DEFAULT_SPEC,normalizeSpec,renderSite,createProjectFiles} from '../local/site-generator.mjs';

test('Six additional designs have distinct structural compositions and share functional page anchors',()=>{
  const compositions={minimal:'page-content',bento:'hero-visual',brutalist:'block-ticker',aurora:'halo-notes',kinetic:'kinetic-art-band',clay:'clay-notes'};
  for(const style of VARIANT_STYLE_IDS){
    const html=renderSite(normalizeSpec({...DEFAULT_SPEC,brand:'A thoughtful business',style}));
    assert.match(html,new RegExp(`<body class="theme-${style} variant-${style}`));
    assert.ok(html.includes(`class="${compositions[style]}`),`${style} needs its own composition`);
    for(const anchor of ['top','services','about','contact'])assert.ok(html.includes(`id="${anchor}"`));
    assert.equal((html.match(/class="menu-toggle"/g)||[]).length,1);
    assert.equal((html.match(/id="main-nav"/g)||[]).length,1);
    assert.equal((html.match(/<form class="contact-form">/g)||[]).length,1);
    assert.ok(html.includes('prefers-reduced-motion'));
    assert.ok(html.includes('@media(max-width:700px)'));
    assert.ok(!html.includes('https://'));
  }
  assert.equal(renderStyleVariant({...DEFAULT_SPEC,style:'glass'},{}),null);
});

test('New design compositions escape user text and retain the existing form and preview protocol',()=>{
  for(const style of VARIANT_STYLE_IDS){
    const html=renderSite(normalizeSpec({...DEFAULT_SPEC,style,brand:'Build & Co.',headline:'A <script>bad</script> headline',description:'A "quoted" description',footer:'<img src=x onerror=bad()>',services:[{title:'One < two',description:'Copy & care.'}]}),{preview:true,projectId:'test-project'});
    assert.ok(html.includes('Build &amp; Co.'));
    assert.ok(html.includes('A &lt;script&gt;bad&lt;/script&gt; headline'));
    assert.ok(html.includes('One &lt; two'));
    assert.ok(html.includes('&lt;img src=x onerror=bad()&gt;'));
    assert.ok(!html.includes('<script>bad</script>'));
    assert.ok(!html.includes('<img src=x'));
    for(const field of ['name','email','company','message','website'])assert.ok(html.includes(`name="${field}"`));
    assert.ok(html.includes('"preview":true'));
    assert.ok(html.includes('"projectId":"test-project"'));
    assert.ok(html.includes("event.data?.type!=='biznova:lead-result'"));
    assert.ok(html.includes("type:'biznova:lead'"));
    assert.ok(html.includes('maxlength="5000"'));
  }
});

test('Toy storefront content and original illustrations retain each additional design composition',()=>{
  for(const style of VARIANT_STYLE_IDS){
    const spec=normalizeSpec({...DEFAULT_SPEC,style,pageType:'toy-store',brand:'Brick & Wonder'});
    const html=renderSite(spec);
    assert.ok(html.includes(`variant-${style} page-toy-store`));
    assert.ok(html.includes('Original colorful building-brick city, rocket and race car'));
    assert.ok(html.includes('Original brick-built city illustration'));
    assert.ok(html.includes('Occasion (optional)'));
    assert.ok(html.includes('What would you like to build?'));
    assert.ok(!html.includes('Good ideas deserve a thoughtful way forward.'));
    assert.ok(!html.includes('Company / brand (optional)'));
    const files=createProjectFiles(spec),document=files.find(f=>f.path==='public/index.html').content;
    assert.ok(document.includes(`variant-${style} page-toy-store`));
    assert.ok(document.includes('"preview":false'));
    assert.ok(files.some(f=>f.path==='server.mjs'&&f.content.includes("url.pathname!=='/api/leads'")));
  }
});

test('Additional compositions preserve every supported collection and use safe internal navigation',()=>{
  for(const style of VARIANT_STYLE_IDS){
    const services=Array.from({length:6},(_,i)=>({title:`Collection ${i+1}`,description:`A distinct description for collection ${i+1}.`}));
    const html=renderSite(normalizeSpec({...DEFAULT_SPEC,style,services,nav:[{label:'Unsafe',href:'https://example.com/other'}]}));
    for(const service of services){assert.ok(html.includes(service.title));assert.ok(html.includes(service.description));}
    assert.ok(html.includes('href="#contact">Unsafe'));
    assert.ok(!html.includes('https://example.com'));
  }
});

test('Accent surface ink remains readable when an existing dark or middle-tone brand color is preserved',()=>{
  const luminance=color=>{
    const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const accents=['#292d32','#000000','#ffffff','#f4ff48','#6372f1','#ff6549','#777777','#777700','#8ce9dc',...Array.from({length:32},(_,i)=>`#${(i*8).toString(16).padStart(2,'0').repeat(3)}`)];
  for(const style of ['brutalist','kinetic'])for(const accent of accents){
    const spec=normalizeSpec({...DEFAULT_SPEC,style,accent}),html=renderSite(spec);
    const ink=html.match(/--accent-ink:(#[0-9a-f]{6})/i)?.[1];
    assert.ok(ink);
    const a=luminance(accent),b=luminance(ink),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(contrast>=4.5,`${style} accent ${accent} and ink ${ink} contrast ${contrast}`);
    assert.equal(spec.accent,accent,'A readability fix must not rewrite the brand color.');
  }
});

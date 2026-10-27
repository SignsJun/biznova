export const DEFAULT_FROM = '2026-09-12';
export const DEFAULT_TO = '2026-10-11';
export const PRODUCTS = [
  { id: 'insulated', name: 'Insulated Bottle', size: '32oz', image: '/images/insulated-bottle.png', color: '#f9f9ad', description: 'Double-wall insulation. An everyday essential that keeps drinks at just the right temperature.' },
  { id: 'sport', name: 'Sport Bottle', size: '24oz', image: '/images/sport-bottle.png', color: '#cbcdef', description: 'Lightweight, durable and ready to go. Made for movement, from the morning commute to the next adventure.' },
  { id: 'travel', name: 'Travel Cup', size: '350ml', image: '/images/travel-cup.png', color: '#d6d5da', description: 'Your daily ritual, made portable. A clean, simple cup for coffee wherever the day takes you.' },
];
export const PLATFORMS = [ { id: 'tiktok', name: 'TikTok Ads', growth: 8.2 }, { id: 'meta', name: 'Meta Reels', growth: 3.1 }, { id: 'google', name: 'Google Shopping', growth: -6.4 } ];
export type ProductFact = { date: string; product: string; platform: string; revenue_cents: number; orders: number };
export type AdFact = { date: string; platform: string; spend_cents: number; sales_cents: number; clicks: number; impressions: number };
export type Filters = { from: string; to: string; platform: string };
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function parseFilters(params: URLSearchParams): Filters {
  const from = params.get('from') || DEFAULT_FROM, to = params.get('to') || DEFAULT_TO, platform = params.get('platform') || 'all';
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
  if (!valid(from) || !valid(to)) throw new Error('Use valid dates in YYYY-MM-DD format.');
  if (from > to) throw new Error('The start date must be on or before the end date.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new Error('Choose a date range of up to 366 days.');
  if (platform !== 'all' && !PLATFORMS.some(p => p.id === platform)) throw new Error('Unknown platform.');
  return { from, to, platform };
}
// Largest-remainder allocation preserves integer cents and exact totals.
export function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a,b) => a+b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map(w => total*w/sum), result = exact.map(Math.floor);
  const order = exact.map((v,i) => ({i, fraction:v-result[i]})).sort((a,b) => b.fraction-a.fraction);
  for (let i=0, left=total-result.reduce((a,b)=>a+b,0); i<left; i++) result[order[i%order.length].i]++;
  return result;
}
function matrix(rows: number[], columns: number[]) {
  const remaining = [...columns];
  return rows.map((total,index) => {
    const values = index === rows.length-1 ? [...remaining] : allocate(total,remaining);
    values.forEach((v,i) => remaining[i]-=v); return values;
  });
}
export function createDemoData(): { products: ProductFact[]; ads: AdFact[] } {
  // The reference calendar's rounded values exceed the headline by $18.15.
  // Reconcile on Sep 12, preserving all exact 10-day chart amounts.
  const revenue = [65685,52300,44600,49500,42500,55500,69700,75100,58600,51200,55000,46800,61000,77300,82800,58800,54400,59300,50100,64200,84900,89300,63200,42900,54500,35700,72800,101700,87900,54000];
  const orders = [...allocate(589,revenue.slice(0,20)),40,42,30,22,27,19,34,41,46,25];
  const productRevenue = matrix(revenue,[1094562,499437,267286]), productOrders = matrix(orders,[438,263,214]);
  const spend = [91280,68972,42608].map(n => allocate(n,revenue)), sales = [201000,248000,139300].map(n=>allocate(n,revenue));
  const products: ProductFact[] = [], ads: AdFact[] = [];
  for (let day=0; day<30; day++) {
    const date = shiftDate(DEFAULT_FROM,day);
    PRODUCTS.forEach((product,pi) => {
      const amounts = allocate(productRevenue[day][pi],[45+(day%4),34,21]), counts = allocate(productOrders[day][pi],[45+(day%4),34,21]);
      PLATFORMS.forEach((platform,ci) => products.push({date,product:product.id,platform:platform.id,revenue_cents:amounts[ci],orders:counts[ci]}));
    });
    PLATFORMS.forEach((platform,ci) => {
      const clicks = 18+((day*7+ci*11)%24);
      ads.push({date,platform:platform.id,spend_cents:spend[ci][day],sales_cents:sales[ci][day],clicks,impressions:Math.round(clicks/[0.014,0.011,0.024][ci])});
    });
  }
  const previousRevenue = allocate(1726640,products.map(p=>p.revenue_cents)), previousOrders = allocate(867,products.map(p=>p.orders));
  return {
    products: [...products.map((p,i)=>({...p,date:shiftDate(p.date,-30),revenue_cents:previousRevenue[i],orders:previousOrders[i]})), ...products],
    ads: [...ads.map(a=>({...a,date:shiftDate(a.date,-30),spend_cents:Math.round(a.spend_cents/1.031),sales_cents:Math.round(a.sales_cents/1.1)})), ...ads],
  };
}
export function aggregateDashboard(products: ProductFact[], ads: AdFact[], filters: Filters) {
  const platformMatch = (r: {platform:string}) => filters.platform==='all' || r.platform===filters.platform;
  const days = Math.round((Date.parse(filters.to)-Date.parse(filters.from))/86400000)+1;
  const prevFrom=shiftDate(filters.from,-days), prevTo=shiftDate(filters.from,-1);
  const current=products.filter(p=>platformMatch(p)&&p.date>=filters.from&&p.date<=filters.to), previous=products.filter(p=>platformMatch(p)&&p.date>=prevFrom&&p.date<=prevTo);
  const currentAds=ads.filter(p=>platformMatch(p)&&p.date>=filters.from&&p.date<=filters.to), prevAds=ads.filter(p=>platformMatch(p)&&p.date>=prevFrom&&p.date<=prevTo);
  const sum = <T,>(rows:T[],key:keyof T) => rows.reduce((n,r)=>n+Number(r[key]),0);
  const revenue=sum(current,'revenue_cents'),prevRevenue=sum(previous,'revenue_cents'),orderCount=sum(current,'orders'),adSpend=sum(currentAds,'spend_cents'),adSales=sum(currentAds,'sales_cents');
  const platformData=PLATFORMS.filter(p=>filters.platform==='all'||p.id===filters.platform).map(platform=>{
    const rows=currentAds.filter(a=>a.platform===platform.id),spendCents=sum(rows,'spend_cents');
    return {...platform,spend:spendCents/100,share:adSpend?spendCents/adSpend*100:0,sales:sum(rows,'sales_cents')/100,ctr:sum(rows,'impressions')?sum(rows,'clicks')/sum(rows,'impressions')*100:0};
  }).sort((a,b)=>b.spend-a.spend);
  const productData=PRODUCTS.map(product=>{
    const rows=current.filter(p=>p.product===product.id),cents=sum(rows,'revenue_cents');
    return {...product,revenue:cents/100,orders:sum(rows,'orders'),share:revenue?cents/revenue*100:0};
  }).sort((a,b)=>b.revenue-a.revenue);
  const calendar=Array.from({length:days},(_,i)=>{
    const date=shiftDate(filters.from,i),rows=current.filter(p=>p.date===date);
    return {date,revenue:sum(rows,'revenue_cents')/100,orders:sum(rows,'orders')};
  });
  const trend=calendar.slice(-10), hourly=[12,18,26,39,59,73,81,86,79,86,84,82,80,78,85,86,87,81,88,78,77,68,59,48];
  const bestAd=[...platformData].sort((a,b)=>b.sales-a.sales)[0],prevSpend=sum(prevAds,'spend_cents'),prevSales=sum(prevAds,'sales_cents');
  return {
    mode:'demo' as const,filters,previousPeriod:{from:prevFrom,to:prevTo},availableRange:{from:'2026-08-13',to:DEFAULT_TO},
    summary:{revenue:revenue/100,previousRevenue:prevRevenue/100,revenueGrowth:prevRevenue?(revenue/prevRevenue-1)*100:null,orders:orderCount,ordersChange:orderCount-sum(previous,'orders'),adSpend:adSpend/100,spendGrowth:prevSpend?(adSpend/prevSpend-1)*100:null,roas:adSpend?adSales/adSpend:0,roasChange:(adSpend?adSales/adSpend:0)-(prevSpend?prevSales/prevSpend:0),bestAd:bestAd?{name:bestAd.name,sales:bestAd.sales}:null,topProduct:productData[0]},
    products:productData,platforms:platformData,audience:hourly.map((level,hour)=>({hour,visitors:Math.round(level*orderCount/30),level:orderCount?level:0})),calendar,trend,
    trendSummary:{orders:sum(trend,'orders'),revenue:Math.round(sum(trend,'revenue')*100)/100},
  };
}
export type DashboardData = ReturnType<typeof aggregateDashboard>;

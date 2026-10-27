import { aggregateDashboard, parseFilters } from '@/lib/dashboard-data';
import { readDashboardRecords } from '@/lib/dashboard-repository';
export async function GET(request:Request) {
  let filters;
  try {filters=parseFilters(new URL(request.url).searchParams);}
  catch(error) {return Response.json({error:(error as Error).message},{status:400});}
  try {
    const records=await readDashboardRecords(),data=aggregateDashboard(records.products,records.ads,filters);
    const csv=['Date,Revenue (USD),Orders,Platform,Data source',...data.calendar.map(d=>`${d.date},${d.revenue.toFixed(2)},${d.orders},${filters.platform},Demo`)].join('\r\n');
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="biznova-${filters.from}-${filters.to}-${filters.platform}.csv"`,'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'Unable to export dashboard data.'},{status:503});}
}

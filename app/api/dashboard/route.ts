import { aggregateDashboard, parseFilters } from '@/lib/dashboard-data';
import { readDashboardRecords } from '@/lib/dashboard-repository';
export async function GET(request:Request) {
  let filters;
  try {filters=parseFilters(new URL(request.url).searchParams);}
  catch(error) {return Response.json({error:(error as Error).message},{status:400});}
  try {
    const records=await readDashboardRecords();
    return Response.json(aggregateDashboard(records.products,records.ads,filters),{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    console.error('Dashboard query failed',error);
    return Response.json({error:'Unable to load dashboard data. Please try again.'},{status:503});
  }
}

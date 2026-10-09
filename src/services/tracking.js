import { isIP } from 'node:net';
import { AppError } from '../lib/errors.js';
export async function recordOutcome(db,{pid,status,input,ip,country},now=new Date()) {
  const project=await db.project.findUnique({where:{pid}});
  if (!project || !project.active) throw new AppError(404,'PROJECT_NOT_FOUND','Project not found or inactive');
  if (input.inTime && (input.inTime > now || (now-input.inTime)/1000 > 2147483647)) throw new AppError(400,'INVALID_TIME','In-time must precede out-time and fit the supported duration');
  const key={projectId_transactionId:{projectId:project.id,transactionId:input.transactionId}};
  const same=existing => {
    if (existing.uid!==input.uid || existing.status!==status || existing.username!==(input.username ?? null) || (existing.inTime?.getTime() ?? null)!==(input.inTime?.getTime() ?? null)) throw new AppError(409,'DUPLICATE_CONFLICT','Transaction identifier already used with different data');
    return {record:existing,duplicate:true};
  };
  const previous=await db.trackingRecord.findUnique({where:key});
  if (previous) return same(previous);
  try {
    const record=await db.trackingRecord.create({data:{projectId:project.id,...input,username:input.username ?? null,inTime:input.inTime ?? null,status,outTime:now,loiSeconds:input.inTime?Math.floor((now-input.inTime)/1000):null,ipAddress:isIP(ip || '')?ip:null,country:country || null}});
    return {record,duplicate:false};
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const winner=await db.trackingRecord.findUnique({where:key});
    if (!winner) throw error;
    return same(winner);
  }
}
export async function listRecords(db,filter) {
  const {page,pageSize,pid,from,to,...rest}=filter;
  const where={...rest,...(pid?{project:{pid}}:{}),...((from || to)?{createdAt:{...(from?{gte:from}:{}),...(to?{lte:to}:{})}}:{})};
  const [records,total]=await db.$transaction([db.trackingRecord.findMany({where,include:{project:{select:{pid:true}}},orderBy:[{createdAt:'desc'},{serial:'desc'}],skip:(page-1)*pageSize,take:pageSize}),db.trackingRecord.count({where})],{isolationLevel:'RepeatableRead'});
  return {records,total,page,pageSize};
}
export function destination(config,{pid,status,input}) {
  const template=config.outcomeUrls[status];
  if (!template) return undefined;
  const values={pid,status,uid:input.uid,transactionId:input.transactionId};
  return template.replace(/\{(pid|status|uid|transactionId)\}/g,(_,key)=>encodeURIComponent(values[key]));
}

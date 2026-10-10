import { z } from 'zod';
export const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/);
export const status = z.enum(['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY']);
export const timestamp = z.iso.datetime({offset:true}).transform(v=>new Date(v));
export const trackingInput = z.object({uid:id,transactionId:id,username:z.string().trim().min(1).max(200).optional(),inTime:timestamp.optional()}).strict();
const optionalPid=z.preprocess(value=>typeof value==='string'&&!value.trim()?null:value,id.nullable());
export const projectInput=z.object({pid:optionalPid.optional().default(null),name:z.string().trim().min(1).max(200)}).strict();
export const projectUpdate=z.object({pid:optionalPid.optional(),name:z.string().trim().min(1).max(200).optional(),active:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0);
export const projectId=z.uuid();
export const filters=z.object({pid:id.optional(),uid:id.optional(),status:status.optional(),country:z.string().regex(/^[A-Z]{2}$/).optional(),from:timestamp.optional(),to:timestamp.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict().refine(v=>!v.from || !v.to || v.from<=v.to);
export const loginInput=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(1024)}).strict();
export function serializeRecord(record) { return {...record,serial:record.serial.toString()}; }

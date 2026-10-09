import { id,status,trackingInput,filters,serializeRecord } from '../lib/validation.js';
import { recordOutcome,listRecords,destination } from '../services/tracking.js';
import { AppError } from '../lib/errors.js';
export function trackingController(db,config,countryResolver) {
  return {
    receive:async(req,res)=>{
      const pid=id.parse(req.params.pid), outcome=status.parse(req.params.status);
      const raw=req.method==='GET'?req.query:req.body;
      const allowed=new Set(Object.values(config.paramMap));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k=>!allowed.has(k))) throw new AppError(400,'VALIDATION_ERROR','Unknown redirect parameters');
      const normalized={};
      for (const [field,external] of Object.entries(config.paramMap)) if (Object.hasOwn(raw,external)) normalized[field]=raw[external];
      const input=trackingInput.parse(normalized);
      // Resolver is server-owned and receives only the network-derived IP, never request values.
      let country=null;
      if (countryResolver) {
        try {const value=await countryResolver(req.ip); if (typeof value==='string' && /^[A-Z]{2}$/.test(value)) country=value;} catch {req.log?.warn({event:'country_lookup_failed'},'Country lookup failed');}
      }
      const result=await recordOutcome(db,{pid,status:outcome,input,ip:req.ip,country});
      const url=destination(config,{pid,status:outcome,input});
      if (url) return res.redirect(303,url);
      res.status(result.duplicate?200:201).json({pid,status:outcome,duplicate:result.duplicate,record:serializeRecord(result.record)});
    },
    list:async(req,res)=>{const result=await listRecords(db,filters.parse(req.query));res.json({...result,records:result.records.map(serializeRecord)});}
  };
}

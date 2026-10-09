import 'dotenv/config';
import { z } from 'zod';
import { isIP } from 'node:net';
const outcomes = ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY'];
export function loadConfig(env = process.env) {
  const base = z.object({ NODE_ENV: z.enum(['development','test','production']).default('development'), PORT: z.coerce.number().int().min(1).max(65535).default(3000), DATABASE_URL: z.string().url().refine(v => /^postgres(ql)?:/.test(v)), AUTH_SECRET: z.string().min(32), SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8) }).parse(env);
  const paramMap = z.object({uid:z.string().min(1),transactionId:z.string().min(1),username:z.string().min(1),inTime:z.string().min(1)}).strict().parse(JSON.parse(env.REDIRECT_PARAM_MAP || '{"uid":"uid","transactionId":"transactionId","username":"username","inTime":"inTime"}'));
  if (new Set(Object.values(paramMap)).size !== 4 || Object.values(paramMap).some(v => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v))) throw new Error('Invalid parameter mapping');
  const urls = z.record(z.string(),z.string()).parse(JSON.parse(env.OUTCOME_URLS || '{}'));
  for (const [status,template] of Object.entries(urls)) {
    if (!outcomes.includes(status) || /\{(?!pid\}|uid\}|status\}|transactionId\})/.test(template)) throw new Error('Invalid outcome URL template');
    const url = new URL(template.replace(/\{(pid|uid|status|transactionId)\}/g,'value'));
    if (url.protocol !== 'https:' || url.username || url.password || /\{/.test(new URL(template).origin)) throw new Error('Outcome destinations must have a fixed HTTPS origin');
  }
  const trustedProxies = (env.TRUST_PROXY || '').split(',').map(v=>v.trim()).filter(Boolean);
  for (const proxy of trustedProxies) {
    const [ip,mask,...extra] = proxy.split('/'); const family = isIP(ip);
    if (!family || extra.length || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) > (family === 4 ? 32 : 128)))) throw new Error('TRUST_PROXY must contain IPs or CIDRs');
  }
  return { ...base, paramMap, outcomeUrls:urls, trustedProxies };
}

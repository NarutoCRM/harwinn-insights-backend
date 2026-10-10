import pino from 'pino';
import {randomUUID} from 'node:crypto';
import { createApp } from '../src/app.js';
import { hashPassword,tokenDigest } from '../src/lib/passwords.js';
export const config={AUTH_SECRET:'test-only-secret-of-at-least-32-characters',SESSION_TTL_HOURS:8,trustedProxies:[],paramMap:{uid:'uid',transactionId:'transactionId',username:'username',inTime:'inTime'},outcomeUrls:{}};
export function fakeDb() {
  const records=[],projects=[{id:'project-a',pid:'A',name:'A',active:true},{id:'project-b',pid:'B',name:'B',active:true}];
  const admin={id:'admin',email:'admin@example.test',active:true,passwordHash:''};
  const sessions=new Map();
  const matches=(r,w)=>Object.entries(w).every(([k,v])=>k==='project'?projects.find(p=>p.id===r.projectId)?.pid===v.pid:k==='createdAt'?(!v.gte||r.createdAt>=v.gte)&&(!v.lte||r.createdAt<=v.lte):r[k]===v);
  const db={records,projects,adminData:admin,sessions,
    admin:{findUnique:async({where})=>where.email===admin.email?admin:null},
    adminSession:{findUnique:async({where})=>sessions.get(where.tokenHash) || null,create:async({data})=>{const s={...data,id:String(sessions.size+1),admin};sessions.set(data.tokenHash,s);return s;},deleteMany:async({where})=>{for(const [k,s] of sessions) if(s.id===where.id)sessions.delete(k);}},
    project:{findUnique:async({where})=>projects.find(p=>where.id?p.id===where.id:p.pid===where.pid)||null,create:async({data})=>{if(data.pid!=null&&projects.some(p=>p.pid===data.pid))throw Object.assign(new Error(),{code:'P2002'});const p={...data,id:randomUUID(),active:true};projects.push(p);return p;},update:async({where,data})=>{const p=projects.find(p=>p.id===where.id);if(!p)throw Object.assign(new Error(),{code:'P2025'});if(data.pid!=null&&projects.some(other=>other.id!==p.id&&other.pid===data.pid))throw Object.assign(new Error(),{code:'P2002'});Object.assign(p,data);return p;},delete:async({where})=>{const i=projects.findIndex(p=>p.id===where.id);if(i<0)throw Object.assign(new Error(),{code:'P2025'});if(records.some(r=>r.projectId===where.id))throw Object.assign(new Error(),{code:'P2003'});return projects.splice(i,1)[0];},findMany:async({skip,take})=>projects.slice(skip,skip+take)},
    trackingRecord:{findUnique:async({where})=>records.find(r=>r.projectId===where.projectId_transactionId.projectId && r.transactionId===where.projectId_transactionId.transactionId)||null,create:async({data})=>{if(records.some(r=>r.projectId===data.projectId&&r.transactionId===data.transactionId))throw Object.assign(new Error(),{code:'P2002'});const r={...data,serial:BigInt(records.length+1),createdAt:new Date()};records.push(r);return r;},findMany:async({where,skip,take})=>records.filter(r=>matches(r,where)).slice().reverse().slice(skip,skip+take).map(r=>({...r,project:{pid:projects.find(p=>p.id===r.projectId).pid}})),count:async({where})=>records.filter(r=>matches(r,where)).length},
    $transaction:async(promises)=>Promise.all(promises),$queryRaw:async()=>[{ok:1}]
  };return db;
}
export function appFor(db,override={},countryResolver) {return createApp({db,config:{...config,...override},logger:pino({level:'silent'}),countryResolver});}
export async function adminToken(db) {
  db.adminData.passwordHash=await hashPassword('test-password-long');
  const token='a'.repeat(43);db.sessions.set(tokenDigest(token,config.AUTH_SECRET),{id:'test',admin:db.adminData,expiresAt:new Date(Date.now()+60000)});return token;
}

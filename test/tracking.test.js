import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {fakeDb,appFor,adminToken} from './helpers.js';
import {recordOutcome} from '../src/services/tracking.js';
for(const status of ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY']) test('records '+status,async()=>{
 const db=fakeDb(), app=appFor(db);const inTime=new Date(Date.now()-60000).toISOString();
 const res=await request(app).get('/redirect/A/'+status).query({uid:'respondent',transactionId:'txn',inTime,username:'User'}).expect(201);
 assert.equal(res.body.status,status);assert.equal(res.body.pid,'A');assert.equal(res.body.record.serial,'1');assert.equal(res.body.record.loiSeconds,60);assert.equal(res.body.record.country,null);assert.ok(res.body.record.ipAddress);assert.ok(res.headers['x-request-id']);
});
test('missing and invalid IDs and outcomes rejected',async()=>{
 const db=fakeDb(),app=appFor(db);
 for(const query of [{},{uid:'u'},{transactionId:'t'},{uid:'',transactionId:'t'},{uid:'bad id',transactionId:'t'},{uid:['u','v'],transactionId:'t'},{uid:'u',transactionId:'t',country:'US'},{uid:'u',transactionId:'t',ip:'1.1.1.1'},{uid:'u',transactionId:'t',inTime:'tomorrow'},{uid:'u',transactionId:'t',inTime:new Date(Date.now()+60000).toISOString()}]) await request(app).get('/redirect/A/COMPLETE').query(query).expect(400);
 await request(app).get('/redirect/bad%20pid/COMPLETE').query({uid:'u',transactionId:'t'}).expect(400);
 await request(app).get('/redirect/A/UNKNOWN').query({uid:'u',transactionId:'t'}).expect(400);
 await request(app).get('/redirect/INVALID/COMPLETE').query({uid:'u',transactionId:'t'}).expect(404);
 await request(app).get('/redirect/COMPLETE').expect(404);
 db.projects[0].active=false;await request(app).post('/redirect/A/COMPLETE').send({uid:'u',transactionId:'t'}).expect(404);assert.equal(db.records.length,0);
});
test('project-scoped idempotency and conflicting duplicates',async()=>{
 const db=fakeDb(),app=appFor(db),body={uid:'u',transactionId:'same'};
 const first=await request(app).post('/redirect/A/COMPLETE').send(body).expect(201);
 const retry=await request(app).post('/redirect/A/COMPLETE').send(body).expect(200);
 assert.equal(retry.body.duplicate,true);assert.equal(retry.body.record.outTime,first.body.record.outTime);
 await request(app).post('/redirect/B/COMPLETE').send(body).expect(201);
 await request(app).post('/redirect/A/TERMINATE').send(body).expect(409);
 await request(app).post('/redirect/A/COMPLETE').send({...body,uid:'another'}).expect(409);
 assert.equal(db.records.length,2);assert.notEqual(db.records[0].projectId,db.records[1].projectId);
});
test('concurrent retry handled by unique constraint',async()=>{
 const db=fakeDb();const data={pid:'A',status:'COMPLETE',input:{uid:'u',transactionId:'race'},ip:'127.0.0.1'};
 const results=await Promise.all([recordOutcome(db,data),recordOutcome(db,data)]);assert.equal(db.records.length,1);assert.equal(results.filter(r=>r.duplicate).length,1);
});
test('database read and write errors sanitized',async()=>{
 for(const target of ['project','trackingRecord']) {const db=fakeDb();db[target][target==='project'?'findUnique':'create']=async()=>{throw Object.assign(new Error('secret-db-password'),{code:'P1001'});};const res=await request(appFor(db)).post('/redirect/A/COMPLETE').send({uid:'u',transactionId:'t'}).expect(503);assert.equal(res.body.error.code,'DATABASE_UNAVAILABLE');assert.ok(!JSON.stringify(res.body).includes('secret'));}
 const db=fakeDb();db.project.findUnique=async()=>{throw new Error('private details');};await request(appFor(db)).post('/redirect/A/COMPLETE').send({uid:'u',transactionId:'t'}).expect(500);
});
test('ignores untrusted forwarded metadata; trusted resolver controls country',async()=>{
 const db=fakeDb();const res=await request(appFor(db,{},async()=> 'IN')).post('/redirect/A/COMPLETE').set('X-Forwarded-For','8.8.8.8').set('CF-IPCountry','US').send({uid:'u',transactionId:'t'}).expect(201);assert.notEqual(res.body.record.ipAddress,'8.8.8.8');assert.equal(res.body.record.country,'IN');
 const second=await request(appFor(db,{},async()=> 'invalid')).post('/redirect/A/COMPLETE').send({uid:'u',transactionId:'t2'}).expect(201);assert.equal(second.body.record.country,null);
});
test('external parameter map and configured fixed destination',async()=>{
 const db=fakeDb(),app=appFor(db,{paramMap:{uid:'external_user',transactionId:'external_txn',username:'name',inTime:'started'},outcomeUrls:{COMPLETE:'https://client.example/result?pid={pid}&uid={uid}&status={status}&txn={transactionId}'}});
 await request(app).get('/redirect/A/COMPLETE').query({uid:'u',transactionId:'t'}).expect(400);
 const res=await request(app).get('/redirect/A/COMPLETE').query({external_user:'u@x',external_txn:'t'}).expect(303);assert.equal(res.headers.location,'https://client.example/result?pid=A&uid=u%40x&status=COMPLETE&txn=t');assert.equal(db.records.length,1);
});
test('authorized filters and pagination isolate projects',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db,{},async()=> 'IN');
 for(const [pid,uid,status,transactionId] of [['A','u','COMPLETE','a'],['A','v','TERMINATE','b'],['B','u','COMPLETE','c']])await request(app).post('/redirect/'+pid+'/'+status).send({uid,transactionId}).expect(201);
 await request(app).get('/api/records').expect(401);
 const res=await request(app).get('/api/records').auth(token,{type:'bearer'}).query({pid:'A',uid:'u',status:'COMPLETE',country:'IN',from:'2020-01-01T00:00:00Z',to:'2099-01-01T00:00:00Z',pageSize:1}).expect(200);assert.equal(res.body.total,1);assert.equal(res.body.records[0].project.pid,'A');
 const page=await request(app).get('/api/records').auth(token,{type:'bearer'}).query({page:2,pageSize:1}).expect(200);assert.equal(page.body.records.length,1);assert.equal(page.body.total,3);
 for(const query of [{pageSize:101},{page:0},{status:'wrong'},{country:'invalid'},{from:'2099-01-01T00:00:00Z',to:'2020-01-01T00:00:00Z'}])await request(app).get('/api/records').auth(token,{type:'bearer'}).query(query).expect(400);
 db.trackingRecord.findMany=async()=>{throw Object.assign(new Error('private'),{code:'P1001'});};await request(app).get('/api/records').auth(token,{type:'bearer'}).expect(503);
});
test('malformed JSON and unexpected fields return validation errors',async()=>{const app=appFor(fakeDb());await request(app).post('/redirect/A/COMPLETE').set('Content-Type','application/json').send('{').expect(400);await request(app).post('/redirect/A/COMPLETE').send({uid:'u',transactionId:'t',redirectUrl:'https://evil.test'}).expect(400);});
test('missing Project ID is rejected before looking up any project',async()=>{
 const db=fakeDb();db.project.findUnique=async()=>{throw new Error('Must not look up a missing ID');};
 for(const pid of [null,undefined,'','   ']) {
  await assert.rejects(()=>recordOutcome(db,{pid,status:'COMPLETE',input:{uid:'u',transactionId:'t'}}),error=>error.code==='PROJECT_ID_REQUIRED');
 }
 assert.equal(db.records.length,0);
});

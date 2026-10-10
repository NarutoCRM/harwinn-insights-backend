import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {fakeDb,appFor,adminToken,config} from './helpers.js';
import {hashPassword,verifyPassword,tokenDigest} from '../src/lib/passwords.js';
import {loadConfig} from '../src/config.js';
test('scrypt hashes are salted and verified',async()=>{const a=await hashPassword('long-password'),b=await hashPassword('long-password');assert.notEqual(a,b);assert.ok(await verifyPassword('long-password',a));assert.equal(await verifyPassword('incorrect',a),false);});
test('login, authenticated access and logout revocation',async()=>{
 const db=fakeDb();await adminToken(db);const app=appFor(db);
 const login=await request(app).post('/api/auth/login').send({email:'ADMIN@example.test',password:'test-password-long'}).expect(200);
 const token=login.body.token;assert.equal(token.length,43);assert.ok(db.sessions.has(tokenDigest(token,config.AUTH_SECRET)));assert.ok(!JSON.stringify([...db.sessions.values()]).includes(token));
 await request(app).get('/api/auth/me').auth(token,{type:'bearer'}).expect(200);
 await request(app).post('/api/auth/logout').auth(token,{type:'bearer'}).expect(204);
 await request(app).get('/api/auth/me').auth(token,{type:'bearer'}).expect(401);
});
test('invalid, unknown and inactive credentials denied',async()=>{
 const db=fakeDb();await adminToken(db);const app=appFor(db);
 for(const input of [{email:'admin@example.test',password:'wrong'},{email:'absent@example.test',password:'test-password-long'}])await request(app).post('/api/auth/login').send(input).expect(401);
 db.adminData.active=false;await request(app).post('/api/auth/login').send({email:'admin@example.test',password:'test-password-long'}).expect(401);
 await request(app).post('/api/auth/login').send({email:'bad',password:'p'}).expect(400);
});
test('expired sessions and inactive admins denied',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db),session=db.sessions.get(tokenDigest(token,config.AUTH_SECRET));
 session.expiresAt=new Date(0);await request(app).get('/api/records').auth(token,{type:'bearer'}).expect(401);session.expiresAt=new Date(Date.now()+60000);db.adminData.active=false;await request(app).get('/api/records').auth(token,{type:'bearer'}).expect(401);
});
test('project APIs require authentication and reject duplicate PIDs',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db);
 await request(app).post('/api/projects').send({pid:'NEW',name:'New project'}).expect(401);
 await request(app).post('/api/projects').auth(token,{type:'bearer'}).send({pid:'NEW',name:'New project'}).expect(201);
 await request(app).post('/api/projects').auth(token,{type:'bearer'}).send({pid:'NEW',name:'New project'}).expect(409);
 await request(app).get('/api/projects').auth(token,{type:'bearer'}).query({pageSize:1}).expect(200);
});
test('configuration rejects insecure secrets, redirects and proxy trust',()=>{
 const base={DATABASE_URL:'postgresql://user:password@localhost/test',AUTH_SECRET:config.AUTH_SECRET};assert.equal(loadConfig(base).PORT,3000);
 for(const overrides of [{AUTH_SECRET:'short'},{DATABASE_URL:'http://localhost'},{TRUST_PROXY:'true'},{TRUST_PROXY:'1.1.1.1/99'},{OUTCOME_URLS:'{"COMPLETE":"http://client.test"}'},{OUTCOME_URLS:'{"COMPLETE":"https://{pid}.test/path"}'},{OUTCOME_URLS:'{"COMPLETE":"https://client.test/{unknown}"}'},{REDIRECT_PARAM_MAP:'{"uid":"id","transactionId":"id","username":"name","inTime":"time"}'}])assert.throws(()=>loadConfig({...base,...overrides}));
 assert.equal(loadConfig({...base,OUTCOME_URLS:'{"COMPLETE":"https://client.test/result?uid={uid}"}'}).outcomeUrls.COMPLETE,'https://client.test/result?uid={uid}');
});

test('authentication database failures and readiness errors are sanitized',async()=>{
 const db=fakeDb(),app=appFor(db);db.admin.findUnique=async()=>{throw Object.assign(new Error('sensitive'),{code:'P1001'});};const response=await request(app).post('/api/auth/login').send({email:'admin@example.test',password:'some-password'}).expect(503);assert.ok(!JSON.stringify(response.body).includes('sensitive'));
 await request(app).get('/health').expect(200);await request(app).get('/ready').expect(200);db.$queryRaw=async()=>{throw Object.assign(new Error('private'),{code:'P1001'});};await request(app).get('/ready').expect(503);
});
test('login rate limit rejects repeated attempts',async()=>{const app=appFor(fakeDb());for(let i=0;i<10;i++)await request(app).post('/api/auth/login').send({email:'invalid'}).expect(400);await request(app).post('/api/auth/login').send({email:'invalid'}).expect(429);});

test('project CRUD validates input and preserves dependent records',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db);
 const created=await request(app).post('/api/projects').auth(token,{type:'bearer'}).send({pid:'CRUD',name:'Original'}).expect(201);
 const path='/api/projects/'+created.body.id;
 await request(app).get(path).expect(401);
 await request(app).patch(path).send({name:'Unauthorized'}).expect(401);
 await request(app).delete(path).expect(401);
 await request(app).get(path).auth(token,{type:'bearer'}).expect(200);
 const updated=await request(app).patch(path).auth(token,{type:'bearer'}).send({name:'Updated',active:false}).expect(200);assert.equal(updated.body.name,'Updated');assert.equal(updated.body.active,false);
 for(const body of [{},{pid:'invalid pid'},{active:'false'},{name:''}])await request(app).patch(path).auth(token,{type:'bearer'}).send(body).expect(400);
 await request(app).post('/redirect/CRUD/COMPLETE').send({uid:'u',transactionId:'t'}).expect(404);
 await request(app).patch(path).auth(token,{type:'bearer'}).send({active:true}).expect(200);
 await request(app).post('/redirect/CRUD/COMPLETE').send({uid:'u',transactionId:'t'}).expect(201);
 await request(app).delete(path).auth(token,{type:'bearer'}).expect(409);assert.equal(db.records.length,1);
 const empty=await request(app).post('/api/projects').auth(token,{type:'bearer'}).send({pid:'EMPTY',name:'Empty'}).expect(201);
 await request(app).delete('/api/projects/'+empty.body.id).auth(token,{type:'bearer'}).expect(204);
 for(const method of ['get','patch','delete']){let call=request(app)[method]('/api/projects/'+empty.body.id).auth(token,{type:'bearer'});if(method==='patch')call=call.send({name:'Missing'});await call.expect(404);}
 await request(app).get('/api/projects/not-a-uuid').auth(token,{type:'bearer'}).expect(400);
});

test('client project IDs can be edited without losing history, isolation or duplicate protection',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db);
 const auth=call=>call.auth(token,{type:'bearer'});
 const first=(await auth(request(app).post('/api/projects')).send({pid:'CLIENT-1',name:'Same company study'}).expect(201)).body;
 const second=(await auth(request(app).post('/api/projects')).send({pid:'CLIENT-2',name:'Same company study'}).expect(201)).body;
 const path='/api/projects/'+first.id;
 await auth(request(app).post('/api/projects')).send({pid:first.pid,name:'Other name'}).expect(409);
 for(const status of ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY']) {
  const input={uid:'respondent',transactionId:'tx-'+status};
  await request(app).post('/redirect/'+first.pid+'/'+status).send(input).expect(201);
  await request(app).post('/redirect/'+second.pid+'/'+status).send(input).expect(201);
 }
 await request(app).patch(path).send({pid:'CLIENT-UPDATED',name:'Updated study'}).expect(401);
 await auth(request(app).patch(path)).send({pid:second.pid,name:'Must not save'}).expect(409);
 const unchanged=(await auth(request(app).get(path)).expect(200)).body;
 assert.equal(unchanged.pid,first.pid);assert.equal(unchanged.name,first.name);
 const updated=(await auth(request(app).patch(path)).send({pid:'CLIENT-UPDATED',name:'Updated study'}).expect(200)).body;
 assert.equal(updated.id,first.id);assert.equal(updated.pid,'CLIENT-UPDATED');assert.equal(updated.name,'Updated study');
 await auth(request(app).patch(path)).send({pid:updated.pid}).expect(200);
 for(const status of ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY']) {
  const input={uid:'respondent',transactionId:'tx-'+status};
  const retry=await request(app).post('/redirect/'+updated.pid+'/'+status).send(input).expect(200);
  assert.equal(retry.body.duplicate,true);assert.equal(retry.body.record.projectId,first.id);
  await request(app).post('/redirect/'+updated.pid+'/'+status).send({...input,uid:'changed'}).expect(409);
 }
 await request(app).post('/redirect/'+first.pid+'/COMPLETE').send({uid:'u',transactionId:'new'}).expect(404);
 for(const pid of [updated.pid,second.pid]) {
  const report=(await auth(request(app).get('/api/records')).query({pid}).expect(200)).body;
  assert.equal(report.total,4);assert.ok(report.records.every(record=>record.project.pid===pid));
 }
 assert.equal(db.records.length,8);
 await auth(request(app).delete(path)).expect(409);
});

test('optional Project IDs persist on create/edit and retain tracking history safely',async()=>{
 const db=fakeDb(),token=await adminToken(db),app=appFor(db);
 const auth=call=>call.auth(token,{type:'bearer'});
 const created=[];
 for(const body of [{name:'Same company'}, {name:'Same company',pid:''}, {name:'Same company',pid:'   '}, {name:'Same company',pid:null}]) {
  const project=(await auth(request(app).post('/api/projects')).send(body).expect(201)).body;
  assert.equal(project.pid,null);created.push(project);
 }
 assert.equal(new Set(created.map(p=>p.id)).size,4);
 const path='/api/projects/'+created[0].id;
 await auth(request(app).patch(path)).send({name:'Saved without ID'}).expect(200);
 assert.equal((await auth(request(app).get(path)).expect(200)).body.name,'Saved without ID');
 await auth(request(app).patch(path)).send({pid:'REAL-ID',name:'With ID'}).expect(200);
 await auth(request(app).patch(path)).send({name:'Name-only edit'}).expect(200);
 assert.equal((await auth(request(app).get(path)).expect(200)).body.pid,'REAL-ID');
 for(const status of ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY']) {
  await request(app).post('/redirect/REAL-ID/'+status).send({uid:'u',transactionId:status}).expect(201);
 }
 for(const pid of ['',null,'   ']) {
  await auth(request(app).patch(path)).send({pid,name:'Cleared ID'}).expect(200);
  assert.equal((await auth(request(app).get(path)).expect(200)).body.pid,null);
 }
 await request(app).post('/redirect/REAL-ID/COMPLETE').send({uid:'u',transactionId:'new'}).expect(404);
 for(const missing of ['', 'null','undefined']) {
  await request(app).post('/redirect/'+missing+'/COMPLETE').send({uid:'u',transactionId:'new'}).expect(404);
 }
 const report=(await auth(request(app).get('/api/records')).expect(200)).body;
 assert.equal(report.total,4);assert.ok(report.records.every(record=>record.project.pid===null));
 assert.ok(db.records.every(record=>record.projectId===created[0].id));
 const list=(await auth(request(app).get('/api/projects')).expect(200)).body;
 assert.ok(list.projects.some(p=>p.id===created[0].id&&p.name==='Cleared ID'&&p.pid===null));
 await auth(request(app).patch(path)).send({pid:'REAL-ID'}).expect(200);
 await auth(request(app).post('/api/projects')).send({pid:'REAL-ID',name:'Duplicate'}).expect(409);
 await auth(request(app).patch('/api/projects/'+created[1].id)).send({pid:'REAL-ID'}).expect(409);
 const retry=await request(app).post('/redirect/REAL-ID/COMPLETE').send({uid:'u',transactionId:'COMPLETE'}).expect(200);
 assert.equal(retry.body.duplicate,true);assert.equal(db.records.length,4);
});

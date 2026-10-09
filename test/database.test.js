import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {appFor} from './helpers.js';
import {hashPassword} from '../src/lib/passwords.js';
import {PrismaClient} from '@prisma/client';
import {recordOutcome} from '../src/services/tracking.js';
// Opt-in: migrations must already be applied to TEST_DATABASE_URL. Never resets a database.
test('PostgreSQL persistence, enum, isolation, concurrent uniqueness and constraints',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const reader=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const suffix=randomUUID();let admin;const pids=['test-a-'+suffix,'test-b-'+suffix];let projects=[];
 try {
  const password=randomBytes(24).toString('hex');
  admin=await db.admin.create({data:{email:'integration-'+suffix+'@example.test',passwordHash:await hashPassword(password)}});
  const app=appFor(db);
  await request(app).get('/health').expect(200);await request(app).get('/ready').expect(200);
  await request(app).get('/api/projects').expect(401);
  const login=await request(app).post('/api/auth/login').send({email:admin.email,password}).expect(200);
  await request(app).get('/api/auth/me').auth(login.body.token,{type:'bearer'}).expect(200);
  for(const pid of pids) {
   const response=await request(app).post('/api/projects').auth(login.body.token,{type:'bearer'}).send({pid,name:'Integration test'}).expect(201);
   projects.push(await reader.project.findUniqueOrThrow({where:{id:response.body.id}}));
  }
  await request(app).get('/api/projects').auth(login.body.token,{type:'bearer'}).expect(200);
  const projectPath='/api/projects/'+projects[0].id;
  await request(app).get(projectPath).auth(login.body.token,{type:'bearer'}).expect(200);
  await request(app).patch(projectPath).auth(login.body.token,{type:'bearer'}).send({name:'Updated integration project',active:false}).expect(200);
  await request(app).post('/redirect/'+pids[0]+'/COMPLETE').send({uid:'u',transactionId:'inactive'}).expect(404);
  await request(app).patch(projectPath).auth(login.body.token,{type:'bearer'}).send({active:true}).expect(200);
  for(const [index,status]of ['COMPLETE','TERMINATE','QUOTAFUL','DISQUALIFY'].entries()) {
   const response=await request(app).post('/redirect/'+pids[0]+'/'+status).send({uid:'u',transactionId:'t'+index,inTime:new Date(Date.now()-10000).toISOString()}).expect(201);
   const persisted=await reader.trackingRecord.findUniqueOrThrow({where:{serial:BigInt(response.body.record.serial)}});
   assert.equal(persisted.status,status);assert.equal(persisted.projectId,projects[0].id);assert.equal(persisted.country,null);
  }
  const data={pid:pids[0],status:'COMPLETE',input:{uid:'u',transactionId:'race'},ip:'::1'};const retries=await Promise.all(Array.from({length:5},()=>recordOutcome(db,data)));assert.equal(retries.filter(r=>!r.duplicate).length,1);
  const duplicate=await request(app).post('/redirect/'+pids[0]+'/COMPLETE').send(data.input).expect(200);assert.equal(duplicate.body.duplicate,true);
  await request(app).post('/redirect/'+pids[0]+'/TERMINATE').send(data.input).expect(409);
  await request(app).post('/redirect/'+pids[1]+'/COMPLETE').send(data.input).expect(201);
  const projectRecords=await request(app).get('/api/records').auth(login.body.token,{type:'bearer'}).query({pid:pids[1]}).expect(200);assert.equal(projectRecords.body.total,1);assert.ok(projectRecords.body.records.every(row=>row.project.pid===pids[1]));
  const filtered=await request(app).get('/api/records').auth(login.body.token,{type:'bearer'}).query({pid:pids[0],uid:'u',status:'TERMINATE',from:'2020-01-01T00:00:00Z',to:'2099-01-01T00:00:00Z',pageSize:1}).expect(200);assert.equal(filtered.body.total,1);
  await request(app).delete(projectPath).auth(login.body.token,{type:'bearer'}).expect(409);
 assert.equal(await db.trackingRecord.count({where:{projectId:projects[0].id}}),5);assert.equal(await db.trackingRecord.count({where:{projectId:projects[1].id}}),1);
  await assert.rejects(()=>recordOutcome(db,{...data,status:'TERMINATE'}),e=>e.status===409);
  await assert.rejects(()=>db.trackingRecord.create({data:{projectId:projects[0].id,uid:'u',transactionId:'invalid-time',status:'COMPLETE',inTime:new Date(Date.now()+60000),outTime:new Date(),loiSeconds:-60}}));
  const empty=await request(app).post('/api/projects').auth(login.body.token,{type:'bearer'}).send({pid:'empty-'+suffix,name:'Empty test project'}).expect(201);
  projects.push({id:empty.body.id});
  await request(app).delete('/api/projects/'+empty.body.id).auth(login.body.token,{type:'bearer'}).expect(204);
  await request(app).get('/api/projects/'+empty.body.id).auth(login.body.token,{type:'bearer'}).expect(404);
  await request(app).post('/api/auth/logout').auth(login.body.token,{type:'bearer'}).expect(204);
  await request(app).get('/api/auth/me').auth(login.body.token,{type:'bearer'}).expect(401);
 } finally {if(projects.length){const ids=projects.map(p=>p.id);await db.trackingRecord.deleteMany({where:{projectId:{in:ids}}});await db.project.deleteMany({where:{id:{in:ids}}});}if(admin)await db.admin.deleteMany({where:{id:admin.id}});await reader.$disconnect();await db.$disconnect();}
});

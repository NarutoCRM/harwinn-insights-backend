import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
// Import the real deployment entry without reading local secrets or querying a DB.
process.env.DOTENV_CONFIG_PATH='test/nonexistent.env';
process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:1/test?connect_timeout=1&connection_limit=1';
process.env.AUTH_SECRET='deployment-test-only-secret-at-least-32-chars';
process.env.NODE_ENV='test';
process.env.OUTCOME_URLS='{}';
process.env.REDIRECT_PARAM_MAP='{"uid":"uid","transactionId":"transactionId","username":"username","inTime":"inTime"}';
process.env.TRUST_PROXY='';
const {default:app}=await import('../index.js');
const origin='https://harwinn-insights-frontend.vercel.app';
const origins=[origin,'https://harwinninsights.com','https://www.harwinninsights.com'];

test('deployment entry allows only the three exact production frontend origins',async()=>{
 for(const allowedOrigin of origins) {
  const response=await request(app).get('/health').set('Origin',allowedOrigin).expect(200);
  assert.equal(response.headers['access-control-allow-origin'],allowedOrigin);
  assert.match(response.headers.vary,/\bOrigin\b/);
  assert.equal(response.headers['access-control-allow-credentials'],undefined);
 }
 for(const rejected of ['https://attacker.example','null',...origins.map(value=>value.replace('https:','http:')),...origins.map(value=>value+'.attacker.example'),'https://preview.harwinninsights.com']) {
  for(const method of ['get','post','options']) {
   const denied=await request(app)[method]('/api/auth/login').set('Origin',rejected).expect(403);
   assert.equal(denied.body.error.code,'CORS_ORIGIN_DENIED');
   assert.equal(denied.headers['access-control-allow-origin'],undefined);
  }
 }
});

test('deployment entry handles preflight before authentication and database access',async()=>{
 for(const origin of origins) {
 for(const method of ['GET','POST','PATCH','PUT','DELETE','OPTIONS']) {
  const response=await request(app).options('/api/auth/login')
   .set('Origin',origin).set('Access-Control-Request-Method',method)
   .set('Access-Control-Request-Headers','content-type,authorization').expect(204);
  assert.equal(response.headers['access-control-allow-origin'],origin);
  assert.deepEqual(response.headers['access-control-allow-methods'].split(/,\s*/),['GET','POST','PATCH','PUT','DELETE','OPTIONS']);
  assert.deepEqual(response.headers['access-control-allow-headers'].split(/,\s*/),['Content-Type','Authorization']);
  assert.equal(response.headers['access-control-allow-credentials'],undefined);
  assert.equal(response.text,'');
 }
 await request(app).options('/api/projects').set('Origin',origin).set('Access-Control-Request-Method','PATCH').expect(204);
 }
});

test('deployment entry preserves CORS headers on validation, auth, not-found and rate-limit errors',async()=>{
 for(const [path,status] of [['/api/auth/me',401],['/missing',404]]) {
  const response=await request(app).get(path).set('Origin',origin).expect(status);
  assert.equal(response.headers['access-control-allow-origin'],origin);
 }
 const invalid=await request(app).post('/api/auth/login').set('Origin',origin)
  .set('Content-Type','application/json').send('{').expect(400);
 assert.equal(invalid.headers['access-control-allow-origin'],origin);
 // Use a fresh shared-app instance so this test does not exhaust other tests' limits.
 const {appFor,fakeDb}=await import('./helpers.js');
 const limitedApp=appFor(fakeDb());
 for(let i=0;i<10;i++)await request(limitedApp).post('/api/auth/login').set('Origin',origin).send({email:'invalid'}).expect(400);
 const limited=await request(limitedApp).post('/api/auth/login').set('Origin',origin).send({email:'invalid'}).expect(429);
 assert.equal(limited.headers['access-control-allow-origin'],origin);
 await request(limitedApp).options('/api/auth/login').set('Origin',origin).set('Access-Control-Request-Method','POST').expect(204);
});
test('deployment entry serves health and preserves protected routes without eager connection',async()=>{
 await request(app).get('/health').expect(200,{status:'ok'});
 for(const path of ['/api/projects','/api/records','/api/auth/me'])await request(app).get(path).expect(401);
 await request(app).post('/api/auth/login').send({email:'invalid'}).expect(400);
 await request(app).get('/redirect/demo/QUOTAFULL').query({uid:'u',transactionId:'t'}).expect(400);
 await request(app).post('/redirect/demo/QUOTAFUL').send({}).expect(400);
 await request(app).get('/missing').expect(404);
});

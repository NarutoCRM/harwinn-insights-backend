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
test('deployment entry serves health and preserves protected routes without eager connection',async()=>{
 await request(app).get('/health').expect(200,{status:'ok'});
 for(const path of ['/api/projects','/api/records','/api/auth/me'])await request(app).get(path).expect(401);
 await request(app).post('/api/auth/login').send({email:'invalid'}).expect(400);
 await request(app).get('/redirect/demo/QUOTAFULL').query({uid:'u',transactionId:'t'}).expect(400);
 await request(app).post('/redirect/demo/QUOTAFUL').send({}).expect(400);
 await request(app).get('/missing').expect(404);
});

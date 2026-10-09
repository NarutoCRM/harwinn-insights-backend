import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config=loadConfig(); const logger=pino({level:'info'}); const db=new PrismaClient();
await db.$connect();
const server=createApp({db,config,logger}).listen(config.PORT,()=>logger.info({port:config.PORT},'Backend listening'));
let shuttingDown=false;
async function shutdown() {
  if(shuttingDown) return; shuttingDown=true;
  const timeout=setTimeout(()=>{server.closeAllConnections();process.exit(1);},10000);timeout.unref();
  server.close(async()=>{await db.$disconnect();clearTimeout(timeout);process.exit(0);});
}
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);

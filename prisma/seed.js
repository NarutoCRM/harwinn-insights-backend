import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../src/lib/passwords.js';
if(process.env.NODE_ENV==='production') throw new Error('Development seed is disabled in production');
const email=z.email().max(254).parse(process.env.SEED_ADMIN_EMAIL).toLowerCase();
const password=z.string().min(12).max(1024).parse(process.env.SEED_ADMIN_PASSWORD);
const db=new PrismaClient();
try {
  if(await db.admin.findUnique({where:{email}})) {console.log('Admin already exists; password unchanged');}
  else {await db.admin.create({data:{email,passwordHash:await hashPassword(password)}});console.log('Admin created');}
} finally {await db.$disconnect();}

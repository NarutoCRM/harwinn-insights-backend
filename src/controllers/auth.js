import { randomBytes } from 'node:crypto';
import { loginInput } from '../lib/validation.js';
import { hashPassword,verifyPassword,tokenDigest } from '../lib/passwords.js';
import { AppError } from '../lib/errors.js';
export function authController(db,config) {
  // Equal password derivation cost even for an unknown email.
  const dummyHash=hashPassword(randomBytes(32).toString('hex'));
  const digest=token=>tokenDigest(token,config.AUTH_SECRET);
  return {
    login:async(req,res)=>{
      const input=loginInput.parse(req.body);
      const admin=await db.admin.findUnique({where:{email:input.email}});
      const valid=await verifyPassword(input.password,admin?.passwordHash || await dummyHash);
      if (!admin?.active || !valid) throw new AppError(401,'INVALID_CREDENTIALS','Invalid email or password');
      const token=randomBytes(32).toString('base64url'); const expiresAt=new Date(Date.now()+config.SESSION_TTL_HOURS*3600000);
      await db.adminSession.create({data:{adminId:admin.id,tokenHash:digest(token),expiresAt}});
      res.json({token,expiresAt,admin:{id:admin.id,email:admin.email}});
    },
    requireAdmin:async(req,res,next)=>{
      const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
      if (!match) throw new AppError(401,'UNAUTHORIZED','Admin authentication required');
      const session=await db.adminSession.findUnique({where:{tokenHash:digest(match[1])},include:{admin:true}});
      if (!session || session.expiresAt<=new Date() || !session.admin.active) throw new AppError(401,'UNAUTHORIZED','Session invalid or expired');
      req.admin=session.admin; req.sessionId=session.id; next();
    },
    logout:async(req,res)=>{await db.adminSession.deleteMany({where:{id:req.sessionId}});res.status(204).end();},
    me:(req,res)=>res.json({id:req.admin.id,email:req.admin.email})
  };
}

export class AppError extends Error {
  constructor(status,code,message) { super(message); this.status=status; this.code=code; }
}
export function errorHandler(error,req,res,next) {
  if (res.headersSent) return next(error);
  let status=error.status || 500, code=error.code || 'INTERNAL_ERROR', message=error.message;
  if (error.name === 'ZodError' || error.type === 'entity.parse.failed') { status=400; code='VALIDATION_ERROR'; message='Invalid request parameters'; }
  else if (error.code === 'P2002') { status=409; code='CONFLICT'; message='Resource already exists'; }
  else if (error.code === 'P2025') { status=404; code='NOT_FOUND'; message='Resource not found'; }
  else if (error.code === 'P2003') { status=409; code='RESOURCE_IN_USE'; message='Resource has dependent records'; }
  else if (/^P\d{4}$/.test(error.code || '') || error.name?.startsWith('Prisma')) { status=503; code='DATABASE_UNAVAILABLE'; message='Database operation failed'; }
  if (status >= 500) { req.log?.error({event:'request_failed',errorType:error.name,code},'Request failed'); message=status===503?'Database operation failed':'Internal server error'; code=status===503?'DATABASE_UNAVAILABLE':'INTERNAL_ERROR'; }
  res.status(status).json({error:{code,message,requestId:req.id}});
}

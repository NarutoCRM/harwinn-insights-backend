const frontendOrigin = "https://harwinn-insights-frontend.vercel.app";
const allowedMethods = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const allowedHeaders = "Content-Type, Authorization";

export function cors(req, res, next) {
  res.vary("Origin");
  const origin = req.get("Origin");
  // Requests without Origin include server-to-server clients and tracking links.
  if (!origin) return next();
  if (origin !== frontendOrigin) {
    return res.status(403).json({
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "Origin not allowed",
        requestId: req.id,
      },
    });
  }

  res.set("Access-Control-Allow-Origin", frontendOrigin);
  // Authentication uses explicit bearer tokens, not ambient cookie credentials.
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", allowedMethods);
    res.set("Access-Control-Allow-Headers", allowedHeaders);
    return res.status(204).end();
  }
  next();
}

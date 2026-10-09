const frontendOrigins = new Set([
  "https://harwinn-insights-frontend.vercel.app",
  "https://harwinninsights.com",
  "https://www.harwinninsights.com",
]);
const allowedMethods = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const allowedHeaders = "Content-Type, Authorization";

export function cors(req, res, next) {
  res.vary("Origin");
  const origin = req.get("Origin");
  // Requests without Origin include server-to-server clients and tracking links.
  if (!origin) return next();
  if (!frontendOrigins.has(origin)) {
    return res.status(403).json({
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "Origin not allowed",
        requestId: req.id,
      },
    });
  }

  res.set("Access-Control-Allow-Origin", origin);
  // Authentication uses explicit bearer tokens, not ambient cookie credentials.
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", allowedMethods);
    res.set("Access-Control-Allow-Headers", allowedHeaders);
    return res.status(204).end();
  }
  next();
}

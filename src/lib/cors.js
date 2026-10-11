const frontendOrigins = new Set([
  "https://harwinn-insights-frontend.vercel.app",
  "https://harwinninsights.com",
  "https://www.harwinninsights.com",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3000",
]);
const localhostPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const allowedMethods = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const allowedHeaders = "Content-Type, Authorization";

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export function cors(req, res, next) {
  res.vary("Origin");
  const origin = req.get("Origin");
  // Requests without Origin include server-to-server clients and tracking links.
  if (!origin) return next();

  const normalizedOrigin = normalizeOrigin(origin);
  const isAllowedOrigin =
    Boolean(normalizedOrigin) &&
    (frontendOrigins.has(normalizedOrigin) ||
      localhostPattern.test(normalizedOrigin));

  if (!isAllowedOrigin) {
    return res.status(403).json({
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "Origin not allowed",
        requestId: req.id,
      },
    });
  }

  res.set("Access-Control-Allow-Origin", normalizedOrigin);
  // Authentication uses explicit bearer tokens, not ambient cookie credentials.
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", allowedMethods);
    res.set("Access-Control-Allow-Headers", allowedHeaders);
    return res.status(204).end();
  }
  next();
}

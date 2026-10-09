import express from "express";
import { z } from "zod";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { authController } from "./controllers/auth.js";
import { trackingController } from "./controllers/tracking.js";
import { projectInput, projectUpdate, projectId } from "./lib/validation.js";
import { AppError, errorHandler } from "./lib/errors.js";
export function createApp({ db, config, logger, countryResolver }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.set(
    "trust proxy",
    config.trustedProxies.length ? config.trustedProxies : false,
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
        err: (err) => ({ type: err.name }),
      },
      customProps: () => ({ service: "harwinn-backend" }),
    }),
  );
  app.use((req, res, next) => {
    res.set("X-Request-Id", req.id);
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  const limiter = (limit) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      validate: { xForwardedForHeader: config.trustedProxies.length > 0 },
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            requestId: req.id,
          },
        }),
    });
  app.use(limiter(1000));
  const auth = authController(db, config),
    tracking = trackingController(db, config, countryResolver);

  app.get("/", (req, res) => res.json({ message: "Hello Server" }));

  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  });
  app.post("/api/auth/login", limiter(10), auth.login);
  app.use("/api", auth.requireAdmin);
  app.get("/api/auth/me", auth.me);
  app.post("/api/auth/logout", auth.logout);
  app.get("/api/records", tracking.list);
  app.post("/api/projects", async (req, res) => {
    const data = projectInput.parse(req.body);
    res.status(201).json(await db.project.create({ data }));
  });
  app.get("/api/projects", async (req, res) => {
    const { page, pageSize } = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(req.query);
    const projects = await db.project.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    res.json({ projects, page, pageSize });
  });
  app.get("/api/projects/:id", async (req, res) => {
    const project = await db.project.findUnique({
      where: { id: projectId.parse(req.params.id) },
    });
    if (!project)
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    res.json(project);
  });
  app.patch("/api/projects/:id", async (req, res) => {
    const id = projectId.parse(req.params.id),
      data = projectUpdate.parse(req.body);
    res.json(await db.project.update({ where: { id }, data }));
  });
  app.delete("/api/projects/:id", async (req, res) => {
    await db.project.delete({ where: { id: projectId.parse(req.params.id) } });
    res.status(204).end();
  });
  app.get("/redirect/:pid/:status", tracking.receive);
  app.post("/redirect/:pid/:status", tracking.receive);
  app.use((req, res, next) =>
    next(new AppError(404, "NOT_FOUND", "Endpoint not found")),
  );
  app.use(errorHandler);
  return app;
}

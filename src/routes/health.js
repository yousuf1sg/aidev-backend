const express = require("express");
const router = express.Router();
const db = require("../services/database");
const aiService = require("../services/ai");

// Detailed health check endpoint
router.get("/", async (req, res) => {
  const health = {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development"
  };

  let hasErrors = false;

  try {
    // Test database connection
    const dbHealth = await db.healthCheck();
    health.services.database = dbHealth;

    if (dbHealth.status !== "healthy") {
      hasErrors = true;
    }
  } catch (error) {
    health.services.database = {
      status: "ERROR",
      message: error.message
    };
    hasErrors = true;
  }

  // Test AI service
  try {
    const aiStats = aiService.getUsageStats();
    health.services.ai = {
      status: aiStats.configured ? "OK" : "WARNING",
      message: aiStats.configured
        ? "API key configured"
        : "API key not configured",
      model: aiStats.model,
      features: aiStats.features
    };

    if (!aiStats.configured) {
      // AI not configured is a warning, not an error
      health.services.ai.status = "WARNING";
    }
  } catch (error) {
    health.services.ai = {
      status: "ERROR",
      message: error.message
    };
    hasErrors = true;
  }

  // Test Redis (if configured)
  if (process.env.REDIS_URL) {
    try {
      // Add Redis health check here if you add Redis later
      health.services.redis = {
        status: "OK",
        message: "URL configured (not tested)"
      };
    } catch (error) {
      health.services.redis = {
        status: "ERROR",
        message: error.message
      };
    }
  } else {
    health.services.redis = {
      status: "DISABLED",
      message: "Redis URL not configured"
    };
  }

  // Memory usage
  const memUsage = process.memoryUsage();
  health.memory = {
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
  };

  // System info
  health.system = {
    platform: process.platform,
    nodeVersion: process.version,
    pid: process.pid
  };

  // Set overall status
  if (hasErrors) {
    health.status = "DEGRADED";
  }

  // Return appropriate status code
  const statusCode = health.status === "OK" ? 200 : 503;
  res.status(statusCode).json(health);
});

// Simple ping endpoint
router.get("/ping", (req, res) => {
  res.json({
    status: "OK",
    message: "pong",
    timestamp: new Date().toISOString()
  });
});

// Readiness check (for Kubernetes/Docker health checks)
router.get("/ready", async (req, res) => {
  try {
    // Test critical services
    await db.query("SELECT 1");

    res.json({
      status: "ready",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Liveness check (for Kubernetes)
router.get("/live", (req, res) => {
  res.json({
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

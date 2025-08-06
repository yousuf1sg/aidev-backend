const express = require("express");
const router = express.Router();
const aiService = require("../services/ai");
const db = require("../services/database");

// Helper function to get user ID
const getUserId = (req) => {
  return req.headers["x-user-id"] || "demo-user";
};

// Validation helpers
const validateChatMessage = (data) => {
  const errors = [];

  if (
    !data.message ||
    typeof data.message !== "string" ||
    data.message.trim().length === 0
  ) {
    errors.push("Message is required and must be a non-empty string");
  }

  if (data.message && data.message.length > 10000) {
    errors.push("Message must be less than 10,000 characters");
  }

  if (data.projectId && typeof data.projectId !== "string") {
    errors.push("Project ID must be a string");
  }

  return errors;
};

// Process chat message and generate code
router.post("/message", async (req, res) => {
  try {
    const { message, projectId } = req.body;
    const userId = getUserId(req);

    console.log(`💬 Processing chat message for user: ${userId}`, {
      messageLength: message?.length,
      projectId
    });

    // Validate input
    const validationErrors = validateChatMessage(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: validationErrors
      });
    }

    let projectContext = "";
    let existingFiles = [];
    let project = null;

    // Get project context if projectId provided
    if (projectId) {
      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(projectId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid project ID format"
        });
      }

      project = await db.getProject(projectId, userId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found"
        });
      }

      projectContext = `Project: ${project.name}\nDescription: ${
        project.description || "No description"
      }\nTemplate: ${project.template_used || "None"}`;
      existingFiles = await db.getProjectFiles(projectId, userId);

      console.log(
        `📁 Found ${existingFiles.length} existing files for context`
      );
    }

    // Check if AI service is configured
    if (!aiService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: "AI service not configured",
        message:
          "Claude API key is required but not provided. Please add CLAUDE_API_KEY environment variable."
      });
    }

    // Generate response using AI
    const result = await aiService.generateCode(
      message.trim(),
      projectContext,
      existingFiles
    );

    // If AI generation failed, return error
    if (!result.success) {
      console.error("❌ AI generation failed:", result.error);
      return res.status(500).json({
        success: false,
        error: "AI generation failed",
        message: result.error,
        code: result.code
      });
    }

    // Save conversation to database if project specified
    let conversation = null;
    if (projectId && result.success) {
      try {
        conversation = await db.saveConversation(
          projectId,
          userId,
          message.trim(),
          result.code,
          result.model || "claude-3-5-sonnet",
          result.usage?.total_tokens || 0
        );
        console.log(`💾 Conversation saved: ${conversation.id}`);
      } catch (dbError) {
        console.error("❌ Failed to save conversation:", dbError);
        // Don't fail the request if conversation saving fails
      }
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        response: result.code,
        usage: result.usage,
        model: result.model,
        projectId,
        conversationId: conversation?.id,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Chat message error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process message",
      message: "An unexpected error occurred while processing your request"
    });
  }
});

// Explain code endpoint
router.post("/explain", async (req, res) => {
  try {
    const { code, language = "javascript" } = req.body;

    console.log(`🔍 Explaining code (${language}):`, {
      codeLength: code?.length
    });

    // Validate input
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Code is required and must be a non-empty string"
      });
    }

    if (code.length > 50000) {
      return res.status(400).json({
        success: false,
        error: "Code must be less than 50,000 characters"
      });
    }

    // Check if AI service is configured
    if (!aiService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: "AI service not configured",
        message: "Claude API key is required but not provided"
      });
    }

    const result = await aiService.explainCode(code.trim(), language);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Code explanation failed",
        message: result.error
      });
    }

    res.json({
      success: true,
      data: {
        explanation: result.explanation,
        language,
        usage: result.usage,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Explain code error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to explain code"
    });
  }
});

// Suggest improvements endpoint
router.post("/improve", async (req, res) => {
  try {
    const { code, context = "" } = req.body;

    console.log(`✨ Suggesting improvements:`, {
      codeLength: code?.length,
      hasContext: !!context
    });

    // Validate input
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Code is required and must be a non-empty string"
      });
    }

    if (code.length > 50000) {
      return res.status(400).json({
        success: false,
        error: "Code must be less than 50,000 characters"
      });
    }

    // Check if AI service is configured
    if (!aiService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: "AI service not configured"
      });
    }

    const result = await aiService.suggestImprovements(code.trim(), context);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Improvement suggestions failed",
        message: result.error
      });
    }

    res.json({
      success: true,
      data: {
        suggestions: result.suggestions,
        usage: result.usage,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Improve code error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to suggest improvements"
    });
  }
});

// Generate tests endpoint
router.post("/tests", async (req, res) => {
  try {
    const { code, framework = "jest" } = req.body;

    console.log(`🧪 Generating tests (${framework}):`, {
      codeLength: code?.length
    });

    // Validate input
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Code is required and must be a non-empty string"
      });
    }

    if (code.length > 50000) {
      return res.status(400).json({
        success: false,
        error: "Code must be less than 50,000 characters"
      });
    }

    // Check if AI service is configured
    if (!aiService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: "AI service not configured"
      });
    }

    const result = await aiService.generateTests(code.trim(), framework);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Test generation failed",
        message: result.error
      });
    }

    res.json({
      success: true,
      data: {
        tests: result.tests,
        framework,
        usage: result.usage,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Generate tests error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate tests"
    });
  }
});

// Get conversation history for a project
router.get("/conversations/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit) || 50;

    console.log(`📚 Fetching conversations for project: ${projectId}`);

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid project ID format"
      });
    }

    // Verify project exists and user has access
    const project = await db.getProject(projectId, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found"
      });
    }

    const conversations = await db.getConversations(
      projectId,
      userId,
      Math.min(limit, 100)
    );

    res.json({
      success: true,
      data: conversations,
      count: conversations.length,
      projectId
    });
  } catch (error) {
    console.error("❌ Get conversations error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversations"
    });
  }
});

// Get AI service status
router.get("/status", (req, res) => {
  try {
    const stats = aiService.getUsageStats();

    res.json({
      success: true,
      data: {
        configured: stats.configured,
        model: stats.model,
        features: stats.features,
        endpoints: [
          "POST /api/chat/message - Generate code from natural language",
          "POST /api/chat/explain - Explain existing code",
          "POST /api/chat/improve - Suggest code improvements",
          "POST /api/chat/tests - Generate unit tests",
          "GET /api/chat/conversations/:projectId - Get conversation history",
          "GET /api/chat/status - Get AI service status"
        ]
      }
    });
  } catch (error) {
    console.error("❌ Chat status error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get chat status"
    });
  }
});

module.exports = router;

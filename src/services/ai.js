const Anthropic = require("@anthropic-ai/sdk");

class AIService {
  constructor() {
    if (!process.env.CLAUDE_API_KEY) {
      console.warn(
        "⚠️  CLAUDE_API_KEY not provided - AI features will be disabled"
      );
      this.anthropic = null;
    } else {
      this.anthropic = new Anthropic({
        apiKey: process.env.CLAUDE_API_KEY
      });
      console.log("✅ Claude AI service initialized");
    }
  }

  isConfigured() {
    return !!this.anthropic;
  }

  async generateCode(prompt, projectContext = "", files = []) {
    if (!this.anthropic) {
      return {
        success: false,
        error:
          "AI service not configured - please add CLAUDE_API_KEY environment variable"
      };
    }

    try {
      // Build context from existing files
      let contextStr = "";
      if (files && files.length > 0) {
        contextStr = "\n\nExisting project files:\n";
        files.forEach((file) => {
          // Only include first 1000 characters of each file to avoid token limits
          const content =
            file.content.length > 1000
              ? file.content.substring(0, 1000) + "\n... (truncated)"
              : file.content;
          contextStr += `\n--- ${file.file_path} ---\n${content}\n`;
        });
      }

      const systemPrompt = `You are an expert full-stack developer helping to build modern web applications. You have expertise in:

- React/TypeScript with modern hooks and patterns
- Node.js/Express.js backend development
- PostgreSQL database design
- Modern CSS with Tailwind
- REST API design
- Security best practices

When generating code:
- Use TypeScript for React components
- Use functional components with hooks
- Include proper error handling
- Add helpful comments
- Follow modern best practices
- Use Tailwind CSS for styling
- Make code production-ready

Always provide complete, functional code that can be used immediately.`;

      const userPrompt = `${
        projectContext ? `Project Context: ${projectContext}\n\n` : ""
      }${contextStr}

User Request: ${prompt}

Please generate clean, functional, and modern code. If creating React components:
- Use TypeScript
- Use functional components with hooks
- Include proper typing
- Use Tailwind CSS for styling
- Add error handling
- Follow React best practices

If creating backend code:
- Use proper error handling
- Include input validation
- Use async/await
- Add helpful logging

If modifying existing code, please provide the complete updated file content.

Respond with just the code, no explanations or markdown formatting unless specifically requested.`;

      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      });

      const generatedCode = message.content[0].text;

      return {
        success: true,
        code: generatedCode,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          total_tokens: message.usage.input_tokens + message.usage.output_tokens
        },
        model: "claude-3-5-sonnet-20241022"
      };
    } catch (error) {
      console.error("❌ AI Generation Error:", error);

      // Handle different types of errors
      let errorMessage = error.message;
      if (error.status === 401) {
        errorMessage =
          "Invalid API key - please check your CLAUDE_API_KEY environment variable";
      } else if (error.status === 429) {
        errorMessage = "Rate limit exceeded - please try again in a moment";
      } else if (error.status === 400) {
        errorMessage =
          "Invalid request - the prompt might be too long or contain unsupported content";
      }

      return {
        success: false,
        error: errorMessage,
        code: error.status || "UNKNOWN"
      };
    }
  }

  async explainCode(code, language = "javascript") {
    if (!this.anthropic) {
      return {
        success: false,
        error:
          "AI service not configured - please add CLAUDE_API_KEY environment variable"
      };
    }

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: `Please explain this ${language} code in simple terms:

${code}

Explain:
1. What it does (main purpose)
2. How it works (key concepts)
3. Important parts to understand
4. Any best practices demonstrated
5. Potential improvements or considerations

Make it beginner-friendly but thorough.`
          }
        ]
      });

      return {
        success: true,
        explanation: message.content[0].text,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          total_tokens: message.usage.input_tokens + message.usage.output_tokens
        }
      };
    } catch (error) {
      console.error("❌ AI Explanation Error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async suggestImprovements(code, context = "") {
    if (!this.anthropic) {
      return {
        success: false,
        error: "AI service not configured"
      };
    }

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: `Please analyze this code and suggest improvements:

${context ? `Context: ${context}\n\n` : ""}${code}

Please provide:
1. Code quality improvements
2. Performance optimizations
3. Security considerations
4. Best practices recommendations
5. Accessibility improvements (if UI code)
6. Error handling enhancements

Format as a structured response with specific, actionable suggestions.`
          }
        ]
      });

      return {
        success: true,
        suggestions: message.content[0].text,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          total_tokens: message.usage.input_tokens + message.usage.output_tokens
        }
      };
    } catch (error) {
      console.error("❌ AI Suggestions Error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateTests(code, framework = "jest") {
    if (!this.anthropic) {
      return {
        success: false,
        error: "AI service not configured"
      };
    }

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: `Generate comprehensive tests for this code using ${framework}:

${code}

Please include:
1. Unit tests for all functions
2. Edge cases and error conditions
3. Mock external dependencies if needed
4. Integration tests where appropriate
5. Clear test descriptions
6. Proper setup and teardown

Provide complete, runnable test code.`
          }
        ]
      });

      return {
        success: true,
        tests: message.content[0].text,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          total_tokens: message.usage.input_tokens + message.usage.output_tokens
        }
      };
    } catch (error) {
      console.error("❌ AI Test Generation Error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get usage statistics
  getUsageStats() {
    return {
      configured: this.isConfigured(),
      model: "claude-3-5-sonnet-20241022",
      features: [
        "Code generation",
        "Code explanation",
        "Improvement suggestions",
        "Test generation"
      ]
    };
  }
}

module.exports = new AIService();

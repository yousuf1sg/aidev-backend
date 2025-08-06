const { Pool } = require("pg");

class DatabaseService {
  constructor() {
    // Validate required environment variables
    this.validateConfig();

    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || "aidevplatform",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    // Test connection on startup
    this.testConnection();
  }

  validateConfig() {
    const required = ["DB_HOST", "DB_PASSWORD"];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  async testConnection() {
    try {
      const client = await this.pool.connect();
      console.log("✅ Database connected successfully");
      client.release();
    } catch (error) {
      console.error("❌ Database connection failed:", error.message);
      process.exit(1);
    }
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log("📊 Query executed", {
        query: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
        duration: `${duration}ms`,
        rows: res.rowCount
      });
      return res;
    } catch (error) {
      console.error("❌ Database query error:", {
        query: text.substring(0, 100),
        error: error.message,
        params: params
      });
      throw error;
    }
  }

  // Projects
  async createProject(userId, name, description, template = null) {
    const query = `
      INSERT INTO projects (user_id, name, description, template_used)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await this.query(query, [
      userId,
      name,
      description,
      template
    ]);
    return result.rows[0];
  }

  async getProjects(userId) {
    const query = `
      SELECT p.*, 
        COALESCE(file_stats.file_count, 0) as file_count,
        COALESCE(conv_stats.conversation_count, 0) as conversation_count,
        conv_stats.last_conversation
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as file_count
        FROM project_files
        GROUP BY project_id
      ) file_stats ON p.id = file_stats.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as conversation_count, MAX(created_at) as last_conversation
        FROM conversations
        GROUP BY project_id
      ) conv_stats ON p.id = conv_stats.project_id
      WHERE p.user_id = $1 AND p.status = 'active'
      ORDER BY p.updated_at DESC
    `;
    const result = await this.query(query, [userId]);
    return result.rows;
  }

  async getProject(projectId, userId) {
    const query = `
      SELECT * FROM projects 
      WHERE id = $1 AND user_id = $2 AND status = 'active'
    `;
    const result = await this.query(query, [projectId, userId]);
    return result.rows[0];
  }

  async updateProject(projectId, userId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    });

    if (fields.length === 0) {
      throw new Error("No fields to update");
    }

    values.push(projectId, userId);
    const query = `
      UPDATE projects 
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await this.query(query, values);
    return result.rows[0];
  }

  async deleteProject(projectId, userId) {
    const query = `
      UPDATE projects 
      SET status = 'deleted', updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await this.query(query, [projectId, userId]);
    return result.rows[0];
  }

  // Conversations
  async saveConversation(
    projectId,
    userId,
    message,
    response,
    aiModel = "claude-3-5-sonnet",
    tokensUsed = 0
  ) {
    const query = `
      INSERT INTO conversations (project_id, user_id, message, response, ai_model, tokens_used)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await this.query(query, [
      projectId,
      userId,
      message,
      response,
      aiModel,
      tokensUsed
    ]);

    // Update project's updated_at timestamp
    await this.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [
      projectId
    ]);

    return result.rows[0];
  }

  async getConversations(projectId, userId, limit = 50) {
    const query = `
      SELECT c.* FROM conversations c
      JOIN projects p ON c.project_id = p.id
      WHERE c.project_id = $1 AND p.user_id = $2
      ORDER BY c.created_at DESC
      LIMIT $3
    `;
    const result = await this.query(query, [projectId, userId, limit]);
    return result.rows.reverse(); // Return in chronological order
  }

  // Project Files
  async saveProjectFile(
    projectId,
    filePath,
    fileName,
    content,
    fileType = "text"
  ) {
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const query = `
      INSERT INTO project_files (project_id, file_path, file_name, content, file_type, size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (project_id, file_path)
      DO UPDATE SET 
        content = EXCLUDED.content,
        file_name = EXCLUDED.file_name,
        file_type = EXCLUDED.file_type,
        size_bytes = EXCLUDED.size_bytes,
        updated_at = NOW()
      RETURNING *
    `;
    const result = await this.query(query, [
      projectId,
      filePath,
      fileName,
      content,
      fileType,
      sizeBytes
    ]);

    // Update project timestamp
    await this.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [
      projectId
    ]);

    return result.rows[0];
  }

  async getProjectFiles(projectId, userId) {
    const query = `
      SELECT pf.* FROM project_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.project_id = $1 AND p.user_id = $2
      ORDER BY pf.file_path
    `;
    const result = await this.query(query, [projectId, userId]);
    return result.rows;
  }

  async getProjectFile(projectId, filePath, userId) {
    const query = `
      SELECT pf.* FROM project_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.project_id = $1 AND pf.file_path = $2 AND p.user_id = $3
    `;
    const result = await this.query(query, [projectId, filePath, userId]);
    return result.rows[0];
  }

  async deleteProjectFile(projectId, filePath, userId) {
    const query = `
      DELETE FROM project_files pf
      USING projects p
      WHERE pf.project_id = p.id 
      AND pf.project_id = $1 
      AND pf.file_path = $2 
      AND p.user_id = $3
      RETURNING pf.*
    `;
    const result = await this.query(query, [projectId, filePath, userId]);
    return result.rows[0];
  }

  // Cleanup and health
  async healthCheck() {
    try {
      const result = await this.query(
        "SELECT NOW() as timestamp, version() as version"
      );
      return {
        status: "healthy",
        timestamp: result.rows[0].timestamp,
        version: result.rows[0].version,
        pool: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        }
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message
      };
    }
  }

  async close() {
    console.log("🔌 Closing database connection pool...");
    await this.pool.end();
  }
}

module.exports = new DatabaseService();

const express = require("express");
const router = express.Router();
const db = require("../services/database");
const { v4: uuidv4 } = require("uuid");

// Helper function to get user ID (replace with real auth later)
const getUserId = (req) => {
  return req.headers["x-user-id"] || "demo-user";
};

// Validation helper
const validateProjectData = (data) => {
  const errors = [];

  if (
    !data.name ||
    typeof data.name !== "string" ||
    data.name.trim().length === 0
  ) {
    errors.push("Project name is required and must be a non-empty string");
  }

  if (data.name && data.name.length > 255) {
    errors.push("Project name must be less than 255 characters");
  }

  if (data.description && typeof data.description !== "string") {
    errors.push("Description must be a string");
  }

  if (data.template && typeof data.template !== "string") {
    errors.push("Template must be a string");
  }

  return errors;
};

// Get all projects for user
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    console.log(`📊 Fetching projects for user: ${userId}`);

    const projects = await db.getProjects(userId);

    res.json({
      success: true,
      data: projects,
      count: projects.length
    });
  } catch (error) {
    console.error("❌ Get projects error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch projects"
    });
  }
});

// Get specific project by ID with files and conversations
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    console.log(`📊 Fetching project ${id} for user: ${userId}`);

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid project ID format"
      });
    }

    const project = await db.getProject(id, userId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found"
      });
    }

    // Get project files and conversations in parallel
    const [files, conversations] = await Promise.all([
      db.getProjectFiles(id, userId),
      db.getConversations(id, userId, 50)
    ]);

    res.json({
      success: true,
      data: {
        project,
        files,
        conversations,
        stats: {
          fileCount: files.length,
          conversationCount: conversations.length
        }
      }
    });
  } catch (error) {
    console.error("❌ Get project error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch project"
    });
  }
});

// Create new project
router.post("/", async (req, res) => {
  try {
    const { name, description, template } = req.body;
    const userId = getUserId(req);

    console.log(`📊 Creating project for user: ${userId}`, { name, template });

    // Validate input
    const validationErrors = validateProjectData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: validationErrors
      });
    }

    // Create project
    const project = await db.createProject(
      userId,
      name.trim(),
      description?.trim() || "",
      template
    );

    // If template specified, create initial files
    if (template) {
      const templateFiles = getTemplateFiles(template);
      const createdFiles = [];

      for (const file of templateFiles) {
        try {
          const createdFile = await db.saveProjectFile(
            project.id,
            file.path,
            file.name,
            file.content,
            file.type
          );
          createdFiles.push(createdFile);
        } catch (fileError) {
          console.error(
            `❌ Error creating template file ${file.path}:`,
            fileError
          );
          // Continue with other files even if one fails
        }
      }

      project.files = createdFiles;
    }

    console.log(`✅ Project created: ${project.id}`);

    res.status(201).json({
      success: true,
      data: project
    });
  } catch (error) {
    console.error("❌ Create project error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create project"
    });
  }
});

// Update project
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    const updates = req.body;

    console.log(`📊 Updating project ${id} for user: ${userId}`);

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid project ID format"
      });
    }

    // Validate updates
    const allowedFields = ["name", "description", "status", "settings"];
    const filteredUpdates = {};

    Object.keys(updates).forEach((key) => {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update"
      });
    }

    // Validate the updates
    if (filteredUpdates.name) {
      const validationErrors = validateProjectData(filteredUpdates);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: validationErrors
        });
      }
    }

    const updatedProject = await db.updateProject(id, userId, filteredUpdates);

    if (!updatedProject) {
      return res.status(404).json({
        success: false,
        error: "Project not found"
      });
    }

    res.json({
      success: true,
      data: updatedProject
    });
  } catch (error) {
    console.error("❌ Update project error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update project"
    });
  }
});

// Delete project (soft delete)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    console.log(`📊 Deleting project ${id} for user: ${userId}`);

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid project ID format"
      });
    }

    const deletedProject = await db.deleteProject(id, userId);

    if (!deletedProject) {
      return res.status(404).json({
        success: false,
        error: "Project not found"
      });
    }

    res.json({
      success: true,
      message: "Project deleted successfully",
      data: deletedProject
    });
  } catch (error) {
    console.error("❌ Delete project error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete project"
    });
  }
});

// Save file to project
router.post("/:id/files", async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { filePath, fileName, content, fileType = "text" } = req.body;
    const userId = getUserId(req);

    console.log(`📁 Saving file to project ${projectId}: ${filePath}`);

    // Validate input
    if (!filePath || !fileName || content === undefined) {
      return res.status(400).json({
        success: false,
        error: "filePath, fileName, and content are required"
      });
    }

    // Verify project ownership
    const project = await db.getProject(projectId, userId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found"
      });
    }

    const file = await db.saveProjectFile(
      projectId,
      filePath,
      fileName,
      content,
      fileType
    );

    res.json({
      success: true,
      data: file
    });
  } catch (error) {
    console.error("❌ Save file error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save file"
    });
  }
});

// Get specific file
router.get("/:id/files/*", async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const filePath = req.params[0]; // Everything after /files/
    const userId = getUserId(req);

    const file = await db.getProjectFile(projectId, filePath, userId);

    if (!file) {
      return res.status(404).json({
        success: false,
        error: "File not found"
      });
    }

    res.json({
      success: true,
      data: file
    });
  } catch (error) {
    console.error("❌ Get file error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch file"
    });
  }
});

// Delete file from project
router.delete("/:id/files", async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { filePath } = req.body;
    const userId = getUserId(req);

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: "filePath is required"
      });
    }

    const deletedFile = await db.deleteProjectFile(projectId, filePath, userId);

    if (!deletedFile) {
      return res.status(404).json({
        success: false,
        error: "File not found"
      });
    }

    res.json({
      success: true,
      message: "File deleted successfully",
      data: deletedFile
    });
  } catch (error) {
    console.error("❌ Delete file error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete file"
    });
  }
});

// Template files function
function getTemplateFiles(template) {
  const templates = {
    "react-basic": [
      {
        path: "src/App.tsx",
        name: "App.tsx",
        type: "typescript",
        content: `import React from 'react';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Welcome to your AI-generated app! 🚀
        </h1>
        <p className="text-gray-600 mb-4">
          This is your starting point. Ask the AI to modify or add features!
        </p>
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-blue-700 text-sm">
            💡 Try asking the AI: "Add a button that changes the background color"
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;`
      },
      {
        path: "package.json",
        name: "package.json",
        type: "json",
        content: JSON.stringify(
          {
            name: "ai-generated-app",
            version: "1.0.0",
            private: true,
            dependencies: {
              react: "^18.2.0",
              "react-dom": "^18.2.0",
              "@types/react": "^18.2.0",
              "@types/react-dom": "^18.2.0",
              typescript: "^5.0.0",
              tailwindcss: "^3.3.0"
            },
            scripts: {
              start: "react-scripts start",
              build: "react-scripts build",
              test: "react-scripts test",
              eject: "react-scripts eject"
            },
            eslintConfig: {
              extends: ["react-app", "react-app/jest"]
            },
            browserslist: {
              production: [">0.2%", "not dead", "not op_mini all"],
              development: [
                "last 1 chrome version",
                "last 1 firefox version",
                "last 1 safari version"
              ]
            }
          },
          null,
          2
        )
      },
      {
        path: "src/index.tsx",
        name: "index.tsx",
        type: "typescript",
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`
      },
      {
        path: "src/index.css",
        name: "index.css",
        type: "css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}`
      }
    ],
    dashboard: [
      {
        path: "src/App.tsx",
        name: "App.tsx",
        type: "typescript",
        content: `import React, { useState } from 'react';

interface DashboardCard {
  id: number;
  title: string;
  value: string;
  change: string;
  positive: boolean;
}

function App() {
  const [cards] = useState<DashboardCard[]>([
    { id: 1, title: 'Total Users', value: '12,543', change: '+12%', positive: true },
    { id: 2, title: 'Revenue', value: '$45,231', change: '+8%', positive: true },
    { id: 3, title: 'Orders', value: '1,234', change: '-3%', positive: false },
    { id: 4, title: 'Growth', value: '23%', change: '+5%', positive: true },
    { id: 5, title: 'Conversion', value: '3.4%', change: '+0.2%', positive: true },
    { id: 6, title: 'Bounce Rate', value: '42%', change: '-1%', positive: true }
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
              New Item
            </button>
          </div>
        </div>
      </div>
      
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {cards.map(card => (
            <div key={card.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">{card.title}</p>
                  <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                </div>
                <div className={\`text-sm font-medium \${card.positive ? 'text-green-600' : 'text-red-600'}\`}>
                  {card.change}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
          <p className="text-gray-600">
            This is your dashboard template. Ask the AI to customize it with charts, tables, or any other features you need!
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;`
      }
    ]
  };

  return templates[template] || [];
}

module.exports = router;

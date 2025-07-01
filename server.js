const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');
const admin = require('firebase-admin');
require('dotenv').config();

class WorkoutMCPServer {
  constructor() {
    this.initializeFirebase();
    
    this.server = new Server(
      {
        name: 'workout-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  initializeFirebase() {
    try {
      // Initialize Firebase Admin
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // For production (Render) - use environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        // For local development - use service account file
        const serviceAccount = require('./firebase-service-account.json');
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      }
      
      this.db = admin.firestore();
      console.error('Firebase initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Firebase:', error);
      throw error;
    }
  }

  setupToolHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'health_check',
            description: 'Simple health check to verify server is running',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_exercises',
            description: 'Get all available exercises from the database',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of exercises to return (default: 20)',
                },
              },
            },
          },
          {
            name: 'get_user_preferences',
            description: 'Get user preferences and goals',
            inputSchema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  description: 'User ID to get preferences for',
                },
              },
              required: ['userId'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'health_check':
          return {
            content: [
              {
                type: 'text',
                text: 'MCP Server is healthy and running!',
              },
            ],
          };

        case 'get_exercises':
          return await this.getExercises(request.params.arguments?.limit || 20);

        case 'get_user_preferences':
          return await this.getUserPreferences(request.params.arguments.userId);

        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }

  async getExercises(limit = 20) {
    try {
      const exercisesSnapshot = await this.db.collection('exercises').limit(limit).get();
      const exercises = [];
      
      exercisesSnapshot.forEach(doc => {
        exercises.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        content: [
          {
            type: 'text',
            text: `Found ${exercises.length} exercises:\n\n${JSON.stringify(exercises, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching exercises: ${error.message}`,
          },
        ],
      };
    }
  }

  async getUserPreferences(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return {
          content: [
            {
              type: 'text',
              text: `User ${userId} not found`,
            },
          ],
        };
      }

      const userData = userDoc.data();
      return {
        content: [
          {
            type: 'text',
            text: `User preferences for ${userId}:\n\n${JSON.stringify(userData, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching user preferences: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    // Create HTTP server for health checks (Render needs this)
    const httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const port = process.env.PORT || 3000;
    httpServer.listen(port, () => {
      console.error(`HTTP health server running on port ${port}`);
    });

    // MCP server on stdio
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Workout MCP server running on stdio');
  }
}

const server = new WorkoutMCPServer();
server.run().catch(console.error);
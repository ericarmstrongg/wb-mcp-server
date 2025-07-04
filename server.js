const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');
const admin = require('firebase-admin');
const OpenAI = require('openai');
require('dotenv').config();

class WorkoutMCPServer {
  constructor() {
    this.initializeFirebase();
    this.initializeOpenAI();
    
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

  initializeOpenAI() {
    try {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.error('OpenAI initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
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
          {
            name: 'generate_workout_recommendation',
            description: 'Generate a personalized workout recommendation based on user preferences and available exercises',
            inputSchema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  description: 'User ID to generate recommendation for',
                },
                workoutType: {
                  type: 'string',
                  description: 'Type of workout requested (e.g., "full body", "upper body", "cardio")',
                },
                timeAvailable: {
                  type: 'number',
                  description: 'Available workout time in minutes',
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

        case 'generate_workout_recommendation':
          return await this.generateWorkoutRecommendation(
            request.params.arguments.userId,
            request.params.arguments.workoutType,
            request.params.arguments.timeAvailable
          );

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

  async generateWorkoutRecommendation(userId, workoutType = 'full body', timeAvailable = 45) {
    try {
      // Get user preferences
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

      // Get available exercises
      const exercisesSnapshot = await this.db.collection('exercises').limit(50).get();
      const exercises = [];
      exercisesSnapshot.forEach(doc => {
        exercises.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Create prompt for OpenAI
      const prompt = `You are a professional personal trainer. Create a personalized workout recommendation based on the following information:

User Profile:
- Experience Level: ${userData.preferences?.experienceLevel || 'Not specified'}
- Primary Goal: ${userData.preferences?.goal || 'Not specified'}
- Activity Level: ${userData.preferences?.activityLevel || 'Not specified'}
- Medical Conditions: ${userData.preferences?.medicalConditions || 'None specified'}

Workout Parameters:
- Type: ${workoutType}
- Time Available: ${timeAvailable} minutes

Available Exercises:
${exercises.map(ex => `- ${ex.name} (${ex.muscle || 'Unknown muscle'}, Equipment: ${ex.equipment || 'Unknown'})`).join('\n')}

Please create a detailed workout plan that includes:
1. A brief explanation of why this workout fits their goals
2. Warm-up routine (5-10 minutes)
3. Main workout with specific exercises, sets, reps, and rest periods
4. Cool-down routine
5. Any modifications for their experience level

Keep the total time within ${timeAvailable} minutes and only use exercises from the provided list.`;

      // Call OpenAI
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert personal trainer who creates safe, effective, and personalized workout plans."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      const recommendation = completion.choices[0].message.content;

      return {
        content: [
          {
            type: 'text',
            text: `Workout Recommendation for User ${userId}:\n\n${recommendation}`,
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating workout recommendation: ${error.message}`,
          },
        ],
      };
    }
  }

  async run() {
    // Create HTTP server for health checks (Render needs this)
    const httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      try {
        if (req.url === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
        } else if (req.url === '/test-exercises') {
          console.error('Testing exercises endpoint...');
          const result = await this.getExercises(5);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } else if (req.url === '/test-user') {
          console.error('Testing user endpoint...');
          const result = await this.getUserPreferences('45q8405xwNNcwC6m9z1PnpyKN6L2');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } else if (req.url === '/test-workout') {
          console.error('Testing workout endpoint...');
          const result = await this.generateWorkoutRecommendation('45q8405xwNNcwC6m9z1PnpyKN6L2', 'full body', 30);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        console.error('HTTP endpoint error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
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

// const server = new WorkoutMCPServer();
// server.run().catch(console.error);
module.exports = WorkoutMCPServer;
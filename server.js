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
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return await this.listAvailableTools();
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.callTool(request.params.name, request.params.arguments || {});
    });
  }

  async getExercises(limit = 20) {
    try {
      const exercisesSnapshot = await this.db.collection('exercises').limit(limit).get();
      const exercises = [];
      exercisesSnapshot.forEach(doc => {
        exercises.push({ id: doc.id, ...doc.data() });
      });

      return {
        content: [
          {
            type: 'text',
            text: `Found ${exercises.length} exercises:

${JSON.stringify(exercises, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error fetching exercises: ${error.message}` },
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
            { type: 'text', text: `User ${userId} not found` },
          ],
        };
      }

      const userData = userDoc.data();
      return {
        content: [
          { type: 'text', text: `User preferences for ${userId}:

${JSON.stringify(userData, null, 2)}` },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error fetching user preferences: ${error.message}` },
        ],
      };
    }
  }

  async generateWorkoutRecommendation(userId, workoutType = 'full body', timeAvailable = 45) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        return {
          content: [
            { type: 'text', text: `User ${userId} not found` },
          ],
        };
      }

      const userData = userDoc.data();
      const exercisesSnapshot = await this.db.collection('exercises').limit(50).get();
      const exercises = [];
      exercisesSnapshot.forEach(doc => {
        exercises.push({ id: doc.id, ...doc.data() });
      });

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
${exercises.map(ex => `- ${ex.name} (${ex.muscle || 'Unknown muscle'}, Equipment: ${ex.equipment || 'Unknown'})`).join('\\n')}

Please create a detailed workout plan...`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are an expert personal trainer..." },
          { role: "user", content: prompt }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      return {
        content: [
          { type: 'text', text: `Workout Recommendation for User ${userId}:

${completion.choices[0].message.content}` },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error generating workout recommendation: ${error.message}` },
        ],
      };
    }
  }

  async callTool(name, args) {
    switch (name) {
      case 'health_check':
        return {
          content: [{ type: 'text', text: 'MCP Server is healthy and running!' }],
        };
      case 'get_exercises':
        return await this.getExercises(args.limit || 20);
      case 'get_user_preferences':
        return await this.getUserPreferences(args.userId);
      case 'generate_workout_recommendation':
        return await this.generateWorkoutRecommendation(
          args.userId,
          args.workoutType,
          args.timeAvailable
        );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async listAvailableTools() {
    return {
      tools: [
        { name: 'health_check', description: 'Simple health check', inputSchema: { type: 'object', properties: {} } },
        { name: 'get_exercises', description: 'Fetch exercises', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
        { name: 'get_user_preferences', description: 'Fetch user prefs', inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] } },
        { name: 'generate_workout_recommendation', description: 'Generate plan', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, workoutType: { type: 'string' }, timeAvailable: { type: 'number' } }, required: ['userId'] } },
      ]
    };
  }

  async run() {
    const port = process.env.PORT || 3000;
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Workout MCP server running on stdio');
  }
}

module.exports = WorkoutMCPServer;
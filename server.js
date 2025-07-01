const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

class WorkoutMCPServer {
  constructor() {
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

        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Workout MCP server running on stdio');
  }
}

const server = new WorkoutMCPServer();
server.run().catch(console.error);
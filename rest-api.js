const express = require('express');
const bodyParser = require('body-parser');
const WorkoutMCPServer = require('./server');
const admin = require('firebase-admin');

const port = process.env.PORT || 3000;

async function main() {
  const mcp = new WorkoutMCPServer();
  await mcp.run();

  const app = express();
  app.use(bodyParser.json());

  app.get('/health', async (req, res) => {
    res.json({
      content: [
        {
          type: 'text',
          text: 'MCP Server is healthy and running!',
        },
      ],
    });
  });

  app.get('/', (req, res) => {
    res.send(`
      <h2>🏋️‍♂️ Workout MCP Server</h2>
      <p>Available endpoints:</p>
      <ul>
        <li><code>GET /health</code> – Check server status</li>
        <li><code>POST /call-tool</code> – Call a tool by name</li>
        <li><code>GET /tools</code> – (optional) List available tools</li>
      </ul>
    `);
  });

  app.get('/tools', async (req, res) => {
    const result = await mcp.server.listAvailableTools();
    res.json(result);
  });

  app.post('/call-tool', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!idToken) {
      return res.status(401).json({ error: 'Missing Firebase ID token' });
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const { name, arguments: args = {} } = req.body;

      if (!args.userId) {
        args.userId = uid;
      } else if (args.userId !== uid) {
        return res.status(403).json({ error: 'User ID mismatch' });
      }

      const result = await mcp.callTool(name, args);
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: 'Invalid Firebase ID token' });
    }
  });

  app.listen(port, () => {
    console.log(`🚀 REST API listening on http://localhost:${port}`);
  });
}

main().catch(err => {
  console.error("❌ Failed to start server:", err);
});
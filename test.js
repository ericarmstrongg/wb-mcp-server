const { spawn } = require('child_process');

class MCPTester {
  constructor() {
    this.requestId = 1;
  }

  async testTool(toolName, args = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['server.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
        } else {
          resolve(output);
        }
      });

      // Initialize MCP connection
      const initMessage = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "test-client",
            version: "1.0.0"
          }
        }
      };

      // List tools
      const listToolsMessage = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "tools/list",
        params: {}
      };

      // Call specific tool
      const callToolMessage = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      };

      // Send messages
      child.stdin.write(JSON.stringify(initMessage) + '\n');
      child.stdin.write(JSON.stringify(listToolsMessage) + '\n');
      child.stdin.write(JSON.stringify(callToolMessage) + '\n');
      child.stdin.end();

      // Auto-resolve after timeout
      setTimeout(() => {
        child.kill();
        resolve(output);
      }, 10000);
    });
  }
}

async function runTests() {
  const tester = new MCPTester();

  console.log('🧪 Testing MCP Tools...\n');

  try {
    // Test 1: Health Check
    console.log('1️⃣ Testing health_check...');
    const healthResult = await tester.testTool('health_check');
    console.log('✅ Health check completed\n');

    // Test 2: Get Exercises
    console.log('2️⃣ Testing get_exercises...');
    const exercisesResult = await tester.testTool('get_exercises', { limit: 5 });
    console.log('✅ Get exercises completed\n');

    // Test 3: Get User Preferences (using the user ID from your screenshot)
    console.log('3️⃣ Testing get_user_preferences...');
    const userResult = await tester.testTool('get_user_preferences', { 
      userId: '45q8405xwNNcwC6m9z1PnpyKN6L2' 
    });
    console.log('✅ Get user preferences completed\n');

    // Test 4: Generate Workout Recommendation
    console.log('4️⃣ Testing generate_workout_recommendation...');
    const workoutResult = await tester.testTool('generate_workout_recommendation', {
      userId: '45q8405xwNNcwC6m9z1PnpyKN6L2',
      workoutType: 'full body',
      timeAvailable: 30
    });
    console.log('✅ Generate workout recommendation completed\n');

    console.log('🎉 All tests completed!');
    console.log('\nNote: Check the output above for any error messages or results.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

runTests();
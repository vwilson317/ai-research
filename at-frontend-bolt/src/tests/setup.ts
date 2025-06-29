import { beforeAll, afterAll } from 'vitest';

// Global test setup
beforeAll(() => {
  // Set up any global test configuration
  console.log('🧪 Starting integration tests...');
  
  // Mock fetch if needed for testing
  if (!global.fetch) {
    global.fetch = require('node-fetch');
  }
});

afterAll(() => {
  console.log('✅ Integration tests completed');
});

// Mock environment variables for testing
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_API_BASE_URL: 'http://localhost:8000',
    VITE_DEV_MODE: 'true',
    VITE_ENABLE_MOCK: 'false',
  },
  writable: true,
}); 
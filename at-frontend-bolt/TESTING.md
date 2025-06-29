# Frontend-Backend Integration Testing

This document describes the integration testing setup for the Audio Transcription application.

## Overview

The integration tests verify that the frontend React application can properly communicate with the backend FastAPI service. These tests cover the complete flow from file upload to transcription completion.

## Test Structure

### Test Files
- `src/tests/integration.test.ts` - Main integration test suite
- `src/tests/setup.ts` - Test environment setup
- `vitest.config.ts` - Vitest configuration
- `scripts/test-integration.sh` - Test runner script

### Test Categories

1. **API Health Check**
   - Backend connectivity
   - Error handling for connection failures

2. **File Upload Integration**
   - Audio file upload
   - File validation
   - Upload error handling

3. **Transcription Job Management**
   - Job creation
   - Status polling
   - Job updates and deletion

4. **TranscriptionService Integration**
   - Service layer functionality
   - Polling mechanism
   - Error handling

5. **Error Handling**
   - Network errors
   - API errors
   - File upload errors

6. **Data Conversion**
   - API response to frontend format conversion

## Running Tests

### Prerequisites

1. **Backend API Running**
   ```bash
   cd audio-transcriber
   python -m uvicorn src.api:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Frontend Dependencies Installed**
   ```bash
   cd at-frontend-bolt
   npm install
   ```

### Test Commands

#### Quick Test Run
```bash
# Run all tests once
npm run test:run

# Run only integration tests
npm run test:integration
```

#### Interactive Test Mode
```bash
# Start interactive test runner
npm run test

# Start test UI (if @vitest/ui is installed)
npm run test:ui
```

#### Using the Test Script
```bash
# Run the comprehensive test script
./scripts/test-integration.sh
```

## Test Configuration

### Environment Variables
The tests use the following environment variables:
- `VITE_API_BASE_URL` - Backend API URL (default: http://localhost:8000)
- `VITE_DEV_MODE` - Development mode flag
- `VITE_ENABLE_MOCK` - Mock service flag

### Test Timeouts
- Individual test timeout: 10 seconds
- Hook timeout: 10 seconds
- Global test timeout: 30 seconds

## Test Coverage

### API Endpoints Tested
- `GET /health` - Health check
- `POST /api/upload` - File upload
- `POST /api/transcribe` - Start transcription
- `GET /api/jobs/{id}` - Get job status
- `GET /api/jobs` - Get all jobs
- `PUT /api/jobs/{id}/transcript` - Update transcript
- `DELETE /api/jobs/{id}` - Delete job

### Frontend Services Tested
- `ApiService` - Direct API communication
- `TranscriptionService` - High-level service layer
- Error handling and retry logic
- Data conversion utilities

## Mock Data

### Audio Files
Tests use mock audio files created with:
```typescript
const createMockAudioFile = (): File => {
  const content = 'mock audio content';
  const blob = new Blob([content], { type: 'audio/wav' });
  return new File([blob], 'test-audio.wav', { type: 'audio/wav' });
};
```

### Test Jobs
Mock transcription jobs are created with realistic data structures that match the API response format.

## Error Scenarios Tested

1. **Network Failures**
   - Invalid API URL
   - Connection timeouts
   - Network errors

2. **API Errors**
   - 404 Not Found
   - 400 Bad Request
   - 500 Internal Server Error

3. **File Upload Errors**
   - Invalid file types
   - Empty files
   - Upload failures

4. **Service Errors**
   - Invalid job IDs
   - Missing files
   - Service unavailability

## Continuous Integration

### GitHub Actions (Recommended)
```yaml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - uses: actions/setup-python@v3
        with:
          python-version: '3.9'
      - run: |
          cd audio-transcriber
          pip install -r requirements.txt
          python -m uvicorn src.api:app --host 0.0.0.0 --port 8000 &
      - run: |
          cd at-frontend-bolt
          npm install
          npm run test:run
```

## Troubleshooting

### Common Issues

1. **Backend Not Running**
   ```
   Error: Backend API is not running on http://localhost:8000
   ```
   **Solution**: Start the backend API server

2. **Port Already in Use**
   ```
   Error: Port 8000 is already in use
   ```
   **Solution**: Kill existing process or change port

3. **Test Timeouts**
   ```
   Error: Test timeout after 10 seconds
   ```
   **Solution**: Check backend performance or increase timeout

4. **CORS Errors**
   ```
   Error: CORS policy violation
   ```
   **Solution**: Ensure backend CORS is configured for test domain

### Debug Mode
Run tests with verbose output:
```bash
npm run test:integration -- --reporter=verbose
```

### Manual Testing
Use the ApiTest component in the frontend to manually verify integration:
1. Start both frontend and backend
2. Navigate to http://localhost:5173
3. Click "API Test" tab
4. Test each functionality manually

## Best Practices

1. **Test Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Always clean up test data after tests complete
3. **Mocking**: Use realistic mock data that matches production format
4. **Error Testing**: Test both success and failure scenarios
5. **Performance**: Keep tests fast and efficient
6. **Documentation**: Keep test documentation up to date

## Future Enhancements

1. **E2E Testing**: Add Playwright or Cypress for full browser testing
2. **Performance Testing**: Add load testing for API endpoints
3. **Security Testing**: Add security vulnerability tests
4. **Accessibility Testing**: Add a11y compliance tests
5. **Visual Regression**: Add visual regression testing for UI components 
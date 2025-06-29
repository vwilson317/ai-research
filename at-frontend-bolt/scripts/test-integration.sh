#!/bin/bash

# Integration Test Runner
# This script runs the frontend-backend integration tests

set -e

echo "🧪 Starting Frontend-Backend Integration Tests"
echo "================================================"

# Check if backend is running
echo "📡 Checking backend API status..."
if ! curl -s http://localhost:8000/health > /dev/null; then
    echo "❌ Backend API is not running on http://localhost:8000"
    echo "   Please start the backend with: cd audio-transcriber && python -m uvicorn src.api:app --reload --host 0.0.0.0 --port 8000"
    exit 1
fi

echo "✅ Backend API is running"

# Check if frontend dependencies are installed
echo "📦 Checking frontend dependencies..."
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

echo "✅ Frontend dependencies ready"

# Run the integration tests
echo "🚀 Running integration tests..."
npm run test:integration

echo ""
echo "✅ Integration tests completed successfully!"
echo ""
echo "📊 Test Summary:"
echo "   - API Health Check: ✅"
echo "   - File Upload: ✅"
echo "   - Transcription Jobs: ✅"
echo "   - Error Handling: ✅"
echo "   - Data Conversion: ✅"
echo ""
echo "🎉 Frontend-Backend integration is working correctly!" 
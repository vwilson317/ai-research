"""
FastAPI application for Audio Transcription Cloud Service.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Audio Transcription API",
    description="Cloud service for audio transcription using OpenAI Whisper.\n\n**Swagger UI available at `/docs`**.",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Root endpoint with basic info."""
    return {
        "message": "Audio Transcription API",
        "version": "1.0.0",
        "status": "running",
        "docs_url": "/docs",
        "redoc_url": "/redoc"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "database": "connected",  # TODO: Add actual DB check
        "storage": "connected"     # TODO: Add actual S3/MinIO check
    }

@app.get("/api/status")
async def get_status():
    """Get API status and configuration."""
    return {
        "api_version": "1.0.0",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "database_url": os.getenv("DATABASE_URL", "not configured"),
        "minio_endpoint": os.getenv("MINIO_ENDPOINT", "not configured"),
        "minio_bucket": os.getenv("MINIO_BUCKET", "not configured")
    }

@app.post("/api/test")
async def test_endpoint():
    """Test endpoint for development."""
    return {
        "message": "API is working!",
        "timestamp": "2024-01-01T00:00:00Z"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 
"""
FastAPI application for Audio Transcription Cloud Service.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os
import logging
import uuid
from datetime import datetime
import json
import tempfile
from pathlib import Path
import asyncio
from threading import Thread

# Import our transcription service
from transcriber import Transcriber

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

# Initialize transcription service
transcription_config = {
    'transcription': {
        'model_size': 'base',  # Options: tiny, base, small, medium, large
        'language': 'auto',
        'include_timestamps': False,
        'output_format': 'txt',
        'task': 'transcribe'
    }
}

transcriber = Transcriber(transcription_config)

# Pydantic models for request/response
class TranscriptionOptions(BaseModel):
    language: Optional[str] = None
    include_timestamps: Optional[bool] = False
    speaker_identification: Optional[bool] = False

class TranscriptionRequest(BaseModel):
    file_id: str
    options: Optional[TranscriptionOptions] = None

class TranscriptUpdate(BaseModel):
    transcript: str

# In-memory storage (replace with database in production)
files_db = {}
jobs_db = {}

# Background task to process transcription
def process_transcription_job(job_id: str, file_path: Path, options: dict = None):
    """Background task to process transcription job."""
    try:
        logger.info(f"Starting transcription job: {job_id}")
        
        # Update job status to processing
        if job_id in jobs_db:
            jobs_db[job_id]['status'] = 'processing'
            jobs_db[job_id]['progress'] = 10
        
        # Apply custom options if provided
        if options:
            if options.get('language'):
                transcriber.language = options['language']
            if options.get('include_timestamps'):
                transcriber.include_timestamps = options['include_timestamps']
        
        # Perform transcription
        transcription_result = transcriber.transcribe_audio(file_path)
        
        if transcription_result:
            # Update job with results
            if job_id in jobs_db:
                jobs_db[job_id]['status'] = 'completed'
                jobs_db[job_id]['progress'] = 100
                jobs_db[job_id]['transcript'] = transcription_result['text']
                jobs_db[job_id]['completed_at'] = datetime.now().isoformat()
                jobs_db[job_id]['language'] = transcription_result.get('language', 'unknown')
                jobs_db[job_id]['metadata'] = transcription_result.get('metadata', {})
            
            logger.info(f"Transcription completed: {job_id}")
        else:
            # Handle transcription failure
            if job_id in jobs_db:
                jobs_db[job_id]['status'] = 'error'
                jobs_db[job_id]['error'] = 'Transcription failed'
                jobs_db[job_id]['completed_at'] = datetime.now().isoformat()
            
            logger.error(f"Transcription failed: {job_id}")
            
    except Exception as e:
        logger.error(f"Error in transcription job {job_id}: {e}")
        if job_id in jobs_db:
            jobs_db[job_id]['status'] = 'error'
            jobs_db[job_id]['error'] = str(e)
            jobs_db[job_id]['completed_at'] = datetime.now().isoformat()

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
        "storage": "connected",     # TODO: Add actual S3/MinIO check
        "transcriber": "ready" if transcriber.model else "not_ready"
    }

@app.get("/api/status")
async def get_status():
    """Get API status and configuration."""
    return {
        "api_version": "1.0.0",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "database_url": os.getenv("DATABASE_URL", "not configured"),
        "minio_endpoint": os.getenv("MINIO_ENDPOINT", "not configured"),
        "minio_bucket": os.getenv("MINIO_BUCKET", "not configured"),
        "transcriber_model": transcriber.model_size if transcriber.model else "not_loaded"
    }

@app.post("/api/test")
async def test_endpoint():
    """Test endpoint for development."""
    return {
        "message": "API is working!",
        "timestamp": "2024-01-01T00:00:00Z"
    }

# File upload endpoint
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an audio file for transcription."""
    try:
        # Validate file type
        if not file.content_type.startswith('audio/'):
            raise HTTPException(status_code=400, detail="Only audio files are allowed")
        
        # Generate unique file ID
        file_id = str(uuid.uuid4())
        
        # Create temporary file
        temp_dir = Path(tempfile.gettempdir()) / "audio_transcriber"
        temp_dir.mkdir(exist_ok=True)
        
        file_path = temp_dir / f"{file_id}_{file.filename}"
        
        # Save uploaded file
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # Store file metadata
        files_db[file_id] = {
            "id": file_id,
            "name": file.filename,
            "size": len(content),
            "content_type": file.content_type,
            "uploaded_at": datetime.now().isoformat(),
            "status": "uploaded",
            "file_path": str(file_path)
        }
        
        logger.info(f"File uploaded: {file.filename} (ID: {file_id})")
        
        return {
            "file_id": file_id,
            "upload_url": f"/api/files/{file_id}",
            "file_name": file.filename,
            "file_size": len(content)
        }
        
    except Exception as e:
        logger.error(f"Upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

# Start transcription endpoint
@app.post("/api/transcribe")
async def start_transcription(request: TranscriptionRequest, background_tasks: BackgroundTasks):
    """Start transcription for an uploaded file."""
    try:
        # Validate file exists
        if request.file_id not in files_db:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Generate job ID
        job_id = str(uuid.uuid4())
        
        # Get file path
        file_path = Path(files_db[request.file_id]["file_path"])
        
        # Create job record
        jobs_db[job_id] = {
            "id": job_id,
            "file_id": request.file_id,
            "file_name": files_db[request.file_id]["name"],
            "file_size": files_db[request.file_id]["size"],
            "status": "pending",
            "progress": 0,
            "created_at": datetime.now().isoformat(),
            "options": request.options.dict() if request.options else {}
        }
        
        # Start background transcription task
        options = request.options.dict() if request.options else {}
        background_tasks.add_task(process_transcription_job, job_id, file_path, options)
        
        logger.info(f"Transcription started: {job_id}")
        
        return {"job_id": job_id}
        
    except Exception as e:
        logger.error(f"Transcription start failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

# Get job status endpoint
@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a transcription job."""
    try:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = jobs_db[job_id]
        return job
        
    except Exception as e:
        logger.error(f"Get job status failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get job status: {str(e)}")

# Get all jobs endpoint
@app.get("/api/jobs")
async def get_all_jobs():
    """Get all transcription jobs."""
    try:
        # TODO: Add pagination and filtering
        jobs = list(jobs_db.values())
        return jobs
        
    except Exception as e:
        logger.error(f"Get all jobs failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {str(e)}")

# Update transcript endpoint
@app.put("/api/jobs/{job_id}/transcript")
async def update_transcript(job_id: str, update: TranscriptUpdate):
    """Update the transcript for a job."""
    try:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail="Job not found")
        
        jobs_db[job_id]["transcript"] = update.transcript
        jobs_db[job_id]["updated_at"] = datetime.now().isoformat()
        
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Update transcript failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update transcript: {str(e)}")

# Delete job endpoint
@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a transcription job and associated files."""
    try:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Get file path to delete
        file_id = jobs_db[job_id]["file_id"]
        if file_id in files_db:
            file_path = Path(files_db[file_id]["file_path"])
            if file_path.exists():
                file_path.unlink()  # Delete the file
            del files_db[file_id]
        
        # Delete job record
        del jobs_db[job_id]
        
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Delete job failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete job: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 
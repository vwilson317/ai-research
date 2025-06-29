import React, { useState, useEffect } from 'react';
import { apiService } from '../services/apiService';

const ApiTest: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [testFile, setTestFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>('');
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => {
    checkHealth();
    loadJobs();
  }, []);

  const checkHealth = async () => {
    try {
      const health = await apiService.healthCheck();
      setHealthStatus(health.status);
    } catch (error) {
      setHealthStatus('Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const loadJobs = async () => {
    try {
      const allJobs = await apiService.getAllJobs();
      setJobs(allJobs);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setTestFile(file);
    }
  };

  const handleUpload = async () => {
    if (!testFile) return;

    try {
      setUploadResult('Uploading...');
      const result = await apiService.uploadFile(testFile);
      setUploadResult(`Upload successful! File ID: ${result.file_id}`);
      
      // Start transcription
      const transcriptionResult = await apiService.startTranscription(result.file_id);
      setUploadResult(prev => prev + `\nTranscription started! Job ID: ${transcriptionResult.job_id}`);
      
      // Reload jobs
      await loadJobs();
    } catch (error) {
      setUploadResult('Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">API Integration Test</h2>
      
      {/* Health Check */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Backend Health</h3>
        <div className={`p-3 rounded ${
          healthStatus === 'healthy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          Status: {healthStatus}
        </div>
        <button 
          onClick={checkHealth}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh Health
        </button>
      </div>

      {/* File Upload Test */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">File Upload Test</h3>
        <input 
          type="file" 
          accept="audio/*"
          onChange={handleFileChange}
          className="mb-2 p-2 border rounded"
        />
        <br />
        <button 
          onClick={handleUpload}
          disabled={!testFile}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300"
        >
          Upload & Transcribe
        </button>
        {uploadResult && (
          <div className="mt-2 p-3 bg-gray-100 rounded">
            <pre className="whitespace-pre-wrap text-sm">{uploadResult}</pre>
          </div>
        )}
      </div>

      {/* Jobs List */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Jobs ({jobs.length})</h3>
        <button 
          onClick={loadJobs}
          className="mb-2 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Refresh Jobs
        </button>
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="p-3 border rounded">
              <div className="font-medium">{job.file_name}</div>
              <div className="text-sm text-gray-600">
                Status: {job.status} | Progress: {job.progress}% | ID: {job.id}
              </div>
            </div>
          ))}
          {jobs.length === 0 && (
            <div className="text-gray-500">No jobs found</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApiTest; 
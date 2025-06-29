import { TranscriptionJob, TranscriptionOptions, AudioFile } from '../types';

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// API Response Types
interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

interface JobResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  transcript?: string;
  error?: string;
  created_at: string;
  completed_at?: string;
  file_id: string;
  file_name: string;
  file_size: number;
}

interface UploadResponse {
  file_id: string;
  upload_url: string;
  file_name: string;
  file_size: number;
}

// API Service Class
export class ApiService {
  private static instance: ApiService;

  static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers: defaultHeaders,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/health');
  }

  // File upload
  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE_URL}/api/upload`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('File upload failed:', error);
      throw error;
    }
  }

  // Start transcription
  async startTranscription(
    fileId: string,
    options: TranscriptionOptions = {}
  ): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('/api/transcribe', {
      method: 'POST',
      body: JSON.stringify({
        file_id: fileId,
        options: {
          language: options.language,
          include_timestamps: options.includeTimestamps,
          speaker_identification: options.speakerIdentification,
        },
      }),
    });
  }

  // Get job status
  async getJobStatus(jobId: string): Promise<JobResponse> {
    return this.request<JobResponse>(`/api/jobs/${jobId}`);
  }

  // Get all jobs
  async getAllJobs(): Promise<JobResponse[]> {
    return this.request<JobResponse[]>('/api/jobs');
  }

  // Update transcript
  async updateTranscript(
    jobId: string,
    transcript: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/jobs/${jobId}/transcript`, {
      method: 'PUT',
      body: JSON.stringify({ transcript }),
    });
  }

  // Delete job
  async deleteJob(jobId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  // Convert API response to frontend format
  convertJobResponse(apiJob: JobResponse): TranscriptionJob {
    return {
      id: apiJob.id,
      audioFile: {
        id: apiJob.file_id,
        file: new File([], apiJob.file_name), // Placeholder file object
        name: apiJob.file_name,
        size: apiJob.file_size,
      },
      status: apiJob.status,
      progress: apiJob.progress,
      transcript: apiJob.transcript,
      error: apiJob.error,
      createdAt: new Date(apiJob.created_at),
      completedAt: apiJob.completed_at ? new Date(apiJob.completed_at) : undefined,
    };
  }
}

// Export singleton instance
export const apiService = ApiService.getInstance(); 
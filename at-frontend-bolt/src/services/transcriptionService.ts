import { TranscriptionJob, TranscriptionOptions } from '../types';
import { apiService } from './apiService';

// Real transcription service using API integration
export class TranscriptionService {
  private static instance: TranscriptionService;
  private jobs: Map<string, TranscriptionJob> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  static getInstance(): TranscriptionService {
    if (!TranscriptionService.instance) {
      TranscriptionService.instance = new TranscriptionService();
    }
    return TranscriptionService.instance;
  }

  async startTranscription(
    job: TranscriptionJob,
    options: TranscriptionOptions = {}
  ): Promise<void> {
    try {
      // First upload the file
      const uploadResponse = await apiService.uploadFile(job.audioFile.file);
      
      // Then start transcription
      const transcriptionResponse = await apiService.startTranscription(
        uploadResponse.file_id,
        options
      );

      // Update job with real IDs
      const updatedJob: TranscriptionJob = {
        ...job,
        id: transcriptionResponse.job_id,
        audioFile: {
          ...job.audioFile,
          id: uploadResponse.file_id,
        },
        status: 'processing',
        progress: 0,
      };

      this.jobs.set(updatedJob.id, updatedJob);

      // Start polling for status updates
      this.startPolling(updatedJob.id);

    } catch (error) {
      console.error('Failed to start transcription:', error);
      const errorJob = {
        ...job,
        status: 'error' as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      this.jobs.set(job.id, errorJob);
      throw error;
    }
  }

  private async startPolling(jobId: string): Promise<void> {
    // Clear any existing polling
    this.stopPolling(jobId);

    const pollInterval = setInterval(async () => {
      try {
        const apiJob = await apiService.getJobStatus(jobId);
        const updatedJob = apiService.convertJobResponse(apiJob);
        
        this.jobs.set(jobId, updatedJob);

        // Stop polling if job is completed or failed
        if (updatedJob.status === 'completed' || updatedJob.status === 'error') {
          this.stopPolling(jobId);
        }
      } catch (error) {
        console.error('Failed to poll job status:', error);
        // Continue polling on error, but maybe add exponential backoff
      }
    }, 2000); // Poll every 2 seconds

    this.pollingIntervals.set(jobId, pollInterval);
  }

  private stopPolling(jobId: string): void {
    const interval = this.pollingIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(jobId);
    }
  }

  async getJob(jobId: string): Promise<TranscriptionJob | undefined> {
    try {
      const apiJob = await apiService.getJobStatus(jobId);
      const job = apiService.convertJobResponse(apiJob);
      this.jobs.set(jobId, job);
      return job;
    } catch (error) {
      console.error('Failed to get job:', error);
      return this.jobs.get(jobId);
    }
  }

  async getAllJobs(): Promise<TranscriptionJob[]> {
    try {
      const apiJobs = await apiService.getAllJobs();
      const jobs = apiJobs.map(apiJob => apiService.convertJobResponse(apiJob));
      
      // Update local cache
      jobs.forEach(job => {
        this.jobs.set(job.id, job);
      });

      return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('Failed to get all jobs:', error);
      // Return cached jobs if API fails
      return Array.from(this.jobs.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    }
  }

  async updateTranscript(jobId: string, transcript: string): Promise<void> {
    try {
      await apiService.updateTranscript(jobId, transcript);
      
      // Update local cache
      const job = this.jobs.get(jobId);
      if (job) {
        this.jobs.set(jobId, { ...job, transcript });
      }
    } catch (error) {
      console.error('Failed to update transcript:', error);
      throw error;
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    try {
      await apiService.deleteJob(jobId);
      
      // Remove from local cache and stop polling
      this.jobs.delete(jobId);
      this.stopPolling(jobId);
    } catch (error) {
      console.error('Failed to delete job:', error);
      throw error;
    }
  }

  // Cleanup method to stop all polling when component unmounts
  cleanup(): void {
    this.pollingIntervals.forEach((interval) => clearInterval(interval));
    this.pollingIntervals.clear();
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      const health = await apiService.healthCheck();
      return health.status === 'healthy';
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}
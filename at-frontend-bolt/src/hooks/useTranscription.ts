import { useState, useCallback } from 'react';
import { TranscriptionJob, TranscriptionOptions, AudioFile } from '../types';
import { TranscriptionService } from '../services/transcriptionService';

export const useTranscription = () => {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const transcriptionService = TranscriptionService.getInstance();

  const startTranscription = useCallback(async (
    audioFile: AudioFile,
    options: TranscriptionOptions = {}
  ) => {
    const job: TranscriptionJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      audioFile,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      groupId: options.groupId
    };

    setJobs(prev => [job, ...prev]);
    setIsLoading(true);

    try {
      await transcriptionService.startTranscription(job, options);
      
      // Poll for updates
      const pollInterval = setInterval(() => {
        const updatedJob = transcriptionService.getJob(job.id);
        if (updatedJob) {
          setJobs(prev => prev.map(j => j.id === job.id ? updatedJob : j));
          
          if (updatedJob.status === 'completed' || updatedJob.status === 'error') {
            clearInterval(pollInterval);
            setIsLoading(false);
          }
        }
      }, 500);

    } catch (error) {
      const errorJob: TranscriptionJob = {
        ...job,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
      setJobs(prev => prev.map(j => j.id === job.id ? errorJob : j));
      setIsLoading(false);
    }
  }, [transcriptionService]);

  const updateTranscript = useCallback((jobId: string, transcript: string) => {
    setJobs(prev => prev.map(job => 
      job.id === jobId ? { ...job, transcript } : job
    ));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setJobs(prev => prev.filter(job => job.id !== jobId));
  }, []);

  const updateJobGroup = useCallback((jobId: string, groupId: string | undefined) => {
    setJobs(prev => prev.map(job => 
      job.id === jobId ? { ...job, groupId } : job
    ));
  }, []);

  return {
    jobs,
    isLoading,
    startTranscription,
    updateTranscript,
    removeJob,
    updateJobGroup
  };
};
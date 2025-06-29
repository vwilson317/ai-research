import { TranscriptionJob, BatchExportOptions } from '../types';

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
    };
    
    audio.onerror = () => {
      reject(new Error('Could not load audio file'));
    };
    
    audio.src = URL.createObjectURL(file);
  });
};

export const isAudioFile = (file: File): boolean => {
  const audioTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/m4a',
    'audio/aac',
    'audio/flac',
    'audio/ogg'
  ];
  return audioTypes.includes(file.type) || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
};

export const generateTranscriptFilename = (audioFilename: string): string => {
  const nameWithoutExt = audioFilename.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  return `${nameWithoutExt}_transcript_${timestamp}.txt`;
};

export const downloadTextFile = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadBatchTranscripts = (
  jobs: TranscriptionJob[],
  options: BatchExportOptions
): void => {
  if (jobs.length === 0) return;

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const groupName = options.groupName || 'transcripts';

  if (options.format === 'zip') {
    // For now, we'll create a combined text file since we don't have a zip library
    // In a real implementation, you'd use a library like JSZip
    downloadCombinedTranscripts(jobs, options, timestamp, groupName);
  } else if (options.separateFiles) {
    // Download each transcript as a separate file
    jobs.forEach((job, index) => {
      if (job.transcript) {
        const filename = `${groupName}_${index + 1}_${generateTranscriptFilename(job.audioFile.name)}`;
        downloadTextFile(job.transcript, filename);
      }
    });
  } else {
    downloadCombinedTranscripts(jobs, options, timestamp, groupName);
  }
};

const downloadCombinedTranscripts = (
  jobs: TranscriptionJob[],
  options: BatchExportOptions,
  timestamp: string,
  groupName: string
): void => {
  let content = '';
  
  if (options.includeMetadata) {
    content += `# ${groupName} - Batch Transcripts\n`;
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Total Files: ${jobs.length}\n\n`;
    content += '---\n\n';
  }

  jobs.forEach((job, index) => {
    if (job.transcript) {
      content += `## ${index + 1}. ${job.audioFile.name}\n\n`;
      
      if (options.includeMetadata) {
        content += `**File Size:** ${formatFileSize(job.audioFile.size)}\n`;
        if (job.audioFile.duration) {
          content += `**Duration:** ${formatDuration(job.audioFile.duration)}\n`;
        }
        content += `**Transcribed:** ${job.completedAt?.toLocaleString()}\n\n`;
      }
      
      content += job.transcript;
      content += '\n\n---\n\n';
    }
  });

  const filename = `${groupName}_batch_transcripts_${timestamp}.${options.format}`;
  downloadTextFile(content, filename);
};

// Helper function to create a ZIP file (requires JSZip library)
// export const createZipFile = async (
//   jobs: TranscriptionJob[],
//   options: BatchExportOptions
// ): Promise<Blob> => {
//   const JSZip = (await import('jszip')).default;
//   const zip = new JSZip();
//   
//   jobs.forEach((job, index) => {
//     if (job.transcript) {
//       const filename = generateTranscriptFilename(job.audioFile.name);
//       zip.file(filename, job.transcript);
//     }
//   });
//   
//   if (options.includeMetadata) {
//     const metadata = createBatchMetadata(jobs);
//     zip.file('metadata.txt', metadata);
//   }
//   
//   return zip.generateAsync({ type: 'blob' });
// };

const createBatchMetadata = (jobs: TranscriptionJob[]): string => {
  let metadata = 'Batch Transcription Metadata\n';
  metadata += '================================\n\n';
  metadata += `Generated: ${new Date().toLocaleString()}\n`;
  metadata += `Total Files: ${jobs.length}\n\n`;
  
  jobs.forEach((job, index) => {
    metadata += `${index + 1}. ${job.audioFile.name}\n`;
    metadata += `   Size: ${formatFileSize(job.audioFile.size)}\n`;
    if (job.audioFile.duration) {
      metadata += `   Duration: ${formatDuration(job.audioFile.duration)}\n`;
    }
    metadata += `   Transcribed: ${job.completedAt?.toLocaleString()}\n`;
    metadata += `   Status: ${job.status}\n\n`;
  });
  
  return metadata;
};
export interface AudioFile {
  file: File;
  id: string;
  name: string;
  size: number;
  duration?: number;
  url?: string;
}

export interface TranscriptionJob {
  id: string;
  audioFile: AudioFile;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  transcript?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  groupId?: string;
}

export interface TranscriptionGroup {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  color: string;
  jobIds: string[];
}

export interface TranscriptionOptions {
  language?: string;
  includeTimestamps?: boolean;
  speakerIdentification?: boolean;
  groupId?: string;
}

export interface ExportFormat {
  type: 'txt' | 'md' | 'pdf';
  label: string;
  extension: string;
}

export interface BatchExportOptions {
  format: 'txt' | 'md' | 'zip';
  includeMetadata: boolean;
  separateFiles: boolean;
  groupName?: string;
}
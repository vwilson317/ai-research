import { useState, useCallback } from 'react';
import { AudioFile } from '../types';
import { isAudioFile, getAudioDuration } from '../utils/fileUtils';

export const useAudioFile = () => {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setIsProcessing(true);
    const fileArray = Array.from(files);
    const validAudioFiles: AudioFile[] = [];

    for (const file of fileArray) {
      if (isAudioFile(file)) {
        try {
          const duration = await getAudioDuration(file);
          const audioFile: AudioFile = {
            file,
            id: `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            size: file.size,
            duration,
            url: URL.createObjectURL(file)
          };
          validAudioFiles.push(audioFile);
        } catch (error) {
          console.warn(`Could not process audio file ${file.name}:`, error);
          // Still add the file, but without duration
          const audioFile: AudioFile = {
            file,
            id: `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            size: file.size,
            url: URL.createObjectURL(file)
          };
          validAudioFiles.push(audioFile);
        }
      }
    }

    setAudioFiles(prev => [...prev, ...validAudioFiles]);
    setIsProcessing(false);
    return validAudioFiles;
  }, []);

  const removeAudioFile = useCallback((id: string) => {
    setAudioFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url);
      }
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const clearAllFiles = useCallback(() => {
    audioFiles.forEach(file => {
      if (file.url) {
        URL.revokeObjectURL(file.url);
      }
    });
    setAudioFiles([]);
  }, [audioFiles]);

  return {
    audioFiles,
    isProcessing,
    processFiles,
    removeAudioFile,
    clearAllFiles
  };
};
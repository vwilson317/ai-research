import React, { useCallback, useState } from 'react';
import { Upload, FileAudio, X, Play, Pause } from 'lucide-react';
import { AudioFile } from '../types';
import { useAudioFile } from '../hooks/useAudioFile';
import { formatFileSize, formatDuration } from '../utils/fileUtils';
import { GroupCreationModal } from './GroupCreationModal';

interface AudioUploaderProps {
  onFilesSelected: (files: AudioFile[], groupId?: string) => void;
  onCreateGroup: (name: string, description?: string) => string;
}

export const AudioUploader: React.FC<AudioUploaderProps> = ({ 
  onFilesSelected, 
  onCreateGroup 
}) => {
  const { audioFiles, isProcessing, processFiles, removeAudioFile } = useAudioFile();
  const [dragActive, setDragActive] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<AudioFile[]>([]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const processedFiles = await processFiles(files);
    
    if (processedFiles.length > 1) {
      // Show group creation modal for multiple files
      setPendingFiles(processedFiles);
      setShowGroupModal(true);
    } else {
      // Single file - no group needed
      onFilesSelected(processedFiles);
    }
  }, [processFiles, onFilesSelected]);

  const handleGroupCreation = (name: string, description?: string) => {
    const groupId = onCreateGroup(name, description);
    onFilesSelected(pendingFiles, groupId);
    setPendingFiles([]);
    return groupId;
  };

  const handleSkipGrouping = () => {
    onFilesSelected(pendingFiles);
    setPendingFiles([]);
  };

  const handleCloseModal = () => {
    setShowGroupModal(false);
    setPendingFiles([]);
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const togglePlayback = (audioFile: AudioFile) => {
    if (playingId === audioFile.id) {
      setPlayingId(null);
    } else {
      setPlayingId(audioFile.id);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
          dragActive
            ? 'border-blue-500 bg-blue-50 scale-105'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept="audio/*"
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        <div className="flex flex-col items-center space-y-4">
          <div className={`p-4 rounded-full transition-colors ${
            dragActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
          }`}>
            <Upload className="w-8 h-8" />
          </div>
          
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Drop your audio files here
            </h3>
            <p className="text-gray-600 mb-4">
              Or click to browse your files
            </p>
            <p className="text-sm text-gray-500 mb-2">
              Supports MP3, WAV, M4A, AAC, FLAC, and OGG files
            </p>
            <p className="text-xs text-blue-600 font-medium">
              💡 Upload multiple files to automatically create a group
            </p>
          </div>
        </div>
      </div>

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="mt-4 flex items-center justify-center space-x-2 text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm">Processing audio files...</span>
        </div>
      )}

      {/* File List */}
      {audioFiles.length > 0 && (
        <div className="mt-6 space-y-3">
          <h4 className="text-lg font-semibold text-gray-900">
            Selected Audio Files ({audioFiles.length})
          </h4>
          
          <div className="space-y-2">
            {audioFiles.map((audioFile) => (
              <div
                key={audioFile.id}
                className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center space-x-4 flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    <FileAudio className="w-6 h-6 text-blue-600" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h5 className="text-sm font-medium text-gray-900 truncate">
                      {audioFile.name}
                    </h5>
                    <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500">
                      <span>{formatFileSize(audioFile.size)}</span>
                      {audioFile.duration && (
                        <span>{formatDuration(audioFile.duration)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  {/* Play/Pause Button */}
                  {audioFile.url && (
                    <button
                      onClick={() => togglePlayback(audioFile)}
                      className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                      title={playingId === audioFile.id ? 'Pause' : 'Play preview'}
                    >
                      {playingId === audioFile.id ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  
                  {/* Remove Button */}
                  <button
                    onClick={() => removeAudioFile(audioFile.id)}
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    title="Remove file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden Audio Elements for Preview */}
      {audioFiles.map((audioFile) => (
        audioFile.url && (
          <audio
            key={audioFile.id}
            src={audioFile.url}
            onEnded={() => setPlayingId(null)}
            ref={(audio) => {
              if (audio) {
                if (playingId === audioFile.id) {
                  audio.play();
                } else {
                  audio.pause();
                }
              }
            }}
            className="hidden"
          />
        )
      ))}

      {/* Group Creation Modal */}
      <GroupCreationModal
        isOpen={showGroupModal}
        fileCount={pendingFiles.length}
        onCreateGroup={handleGroupCreation}
        onSkip={handleSkipGrouping}
        onClose={handleCloseModal}
      />
    </div>
  );
};
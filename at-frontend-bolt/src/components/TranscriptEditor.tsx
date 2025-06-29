import React, { useState, useRef, useEffect } from 'react';
import { 
  Download, 
  Copy, 
  Check, 
  Edit3, 
  Save, 
  FileText, 
  Clock,
  User
} from 'lucide-react';
import { TranscriptionJob } from '../types';
import { generateTranscriptFilename, downloadTextFile } from '../utils/fileUtils';

interface TranscriptEditorProps {
  job: TranscriptionJob;
  onTranscriptUpdate: (jobId: string, transcript: string) => void;
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  job,
  onTranscriptUpdate
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState(job.transcript || '');
  const [isCopied, setIsCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditedTranscript(job.transcript || '');
  }, [job.transcript]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleSave = () => {
    onTranscriptUpdate(job.id, editedTranscript);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedTranscript(job.transcript || '');
    setIsEditing(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedTranscript);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  const handleDownload = () => {
    const filename = generateTranscriptFilename(job.audioFile.name);
    downloadTextFile(editedTranscript, filename);
  };

  const wordCount = editedTranscript.trim().split(/\s+/).filter(word => word.length > 0).length;
  const charCount = editedTranscript.length;
  const estimatedReadingTime = Math.ceil(wordCount / 200); // ~200 words per minute

  if (job.status !== 'completed' || !job.transcript) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No transcript available
          </h3>
          <p className="text-gray-600">
            {job.status === 'processing' 
              ? 'Transcription is in progress...' 
              : 'Complete transcription to view results'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Transcript
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {job.audioFile.name}
            </p>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              title="Copy to clipboard"
            >
              {isCopied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 text-gray-600" />
              )}
              <span className="ml-2">
                {isCopied ? 'Copied!' : 'Copy'}
              </span>
            </button>
            
            <button
              onClick={handleDownload}
              className="inline-flex items-center px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              title="Download transcript"
            >
              <Download className="w-4 h-4" />
              <span className="ml-2">Download</span>
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center space-x-6 text-sm text-gray-600">
          <div className="flex items-center space-x-1">
            <FileText className="w-4 h-4" />
            <span>{wordCount} words</span>
          </div>
          <div className="flex items-center space-x-1">
            <User className="w-4 h-4" />
            <span>{charCount} characters</span>
          </div>
          <div className="flex items-center space-x-1">
            <Clock className="w-4 h-4" />
            <span>~{estimatedReadingTime} min read</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isEditing ? (
          <div className="space-y-4">
            <textarea
              ref={textareaRef}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              className="w-full h-96 p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Edit your transcript here..."
            />
            
            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-900">Transcript Content</h4>
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Edit3 className="w-4 h-4 mr-1" />
                Edit
              </button>
            </div>
            
            <div className="prose prose-sm max-w-none">
              <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-gray-900 leading-relaxed">
                {editedTranscript}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
import React, { useState } from 'react';
import { AudioUploader } from './components/AudioUploader';
import { TranscriptionProgress } from './components/TranscriptionProgress';
import { TranscriptEditor } from './components/TranscriptEditor';
import { GroupManager } from './components/GroupManager';
import { useAudioFile } from './hooks/useAudioFile';
import { useTranscription } from './hooks/useTranscription';
import { useTranscriptionGroups } from './hooks/useTranscriptionGroups';
import { AudioFile, TranscriptionJob } from './types';
import { FileAudio, Zap, Download, Smartphone, Users } from 'lucide-react';

function App() {
  const { audioFiles } = useAudioFile();
  const { jobs, isLoading, startTranscription, updateTranscript, updateJobGroup } = useTranscription();
  const { 
    groups, 
    createGroup, 
    updateGroup, 
    deleteGroup, 
    addJobToGroup, 
    removeJobFromGroup 
  } = useTranscriptionGroups();
  const [selectedJob, setSelectedJob] = useState<TranscriptionJob | null>(null);
  const [activeTab, setActiveTab] = useState<'transcribe' | 'groups'>('transcribe');

  const handleFilesSelected = (files: AudioFile[], groupId?: string) => {
    // Auto-start transcription for newly uploaded files
    files.forEach(file => {
      startTranscription(file, { groupId });
    });
  };

  const handleCreateGroup = (name: string, description?: string) => {
    const group = createGroup(name, description);
    return group.id;
  };

  const handleJobSelect = (job: TranscriptionJob) => {
    setSelectedJob(job);
  };

  const handleTranscriptUpdate = (jobId: string, transcript: string) => {
    updateTranscript(jobId, transcript);
    // Update selected job if it's the one being edited
    if (selectedJob?.id === jobId) {
      setSelectedJob({ ...selectedJob, transcript });
    }
  };

  const handleAddJobToGroup = (groupId: string, jobId: string) => {
    addJobToGroup(groupId, jobId);
    updateJobGroup(jobId, groupId);
  };

  const handleRemoveJobFromGroup = (jobId: string) => {
    removeJobFromGroup(jobId);
    updateJobGroup(jobId, undefined);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-xl">
                <FileAudio className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Audio Transcription
                </h1>
                <p className="text-sm text-gray-600">
                  Convert audio files to text transcripts for iCloud sync
                </p>
              </div>
            </div>
            
            <div className="hidden sm:flex items-center space-x-6 text-sm text-gray-600">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-blue-600" />
                <span>AI-Powered</span>
              </div>
              <div className="flex items-center space-x-2">
                <Download className="w-4 h-4 text-green-600" />
                <span>iCloud Ready</span>
              </div>
              <div className="flex items-center space-x-2">
                <Smartphone className="w-4 h-4 text-purple-600" />
                <span>iPhone Compatible</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-6 border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('transcribe')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'transcribe'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <FileAudio className="w-4 h-4" />
                  <span>Transcribe</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab('groups')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'groups'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4" />
                  <span>Groups ({groups.length})</span>
                </div>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'transcribe' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Upload & Progress */}
            <div className="space-y-8">
              {/* Upload Section */}
              <section>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Upload Audio Files
                  </h2>
                  <p className="text-gray-600">
                    Drag and drop your audio files or click to browse. Multiple files will be automatically grouped together.
                  </p>
                </div>
                
                <AudioUploader 
                  onFilesSelected={handleFilesSelected}
                  onCreateGroup={handleCreateGroup}
                />
              </section>

              {/* Progress Section */}
              <section>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Transcription Jobs
                  </h2>
                  <p className="text-gray-600">
                    Track the progress of your audio transcriptions and organize them into groups.
                  </p>
                </div>
                
                <TranscriptionProgress
                  jobs={jobs}
                  groups={groups}
                  onJobSelect={handleJobSelect}
                  selectedJobId={selectedJob?.id}
                  onAddJobToGroup={handleAddJobToGroup}
                  onRemoveJobFromGroup={handleRemoveJobFromGroup}
                  onCreateGroup={handleCreateGroup}
                />
              </section>
            </div>

            {/* Right Column - Transcript Editor */}
            <div className="space-y-8">
              <section>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Transcript Editor
                  </h2>
                  <p className="text-gray-600">
                    Review, edit, and export your transcripts. Files can be saved to iCloud Drive for iPhone access.
                  </p>
                </div>
                
                {selectedJob ? (
                  <TranscriptEditor
                    job={selectedJob}
                    onTranscriptUpdate={handleTranscriptUpdate}
                  />
                ) : (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="text-center py-12">
                      <FileAudio className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Select a transcription job
                      </h3>
                      <p className="text-gray-600">
                        Choose a completed transcription from the left panel to view and edit the transcript.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : (
          /* Groups Tab */
          <div className="max-w-4xl mx-auto">
            <GroupManager
              groups={groups}
              jobs={jobs}
              onCreateGroup={handleCreateGroup}
              onUpdateGroup={updateGroup}
              onDeleteGroup={deleteGroup}
              onAddJobToGroup={handleAddJobToGroup}
              onRemoveJobFromGroup={handleRemoveJobFromGroup}
            />
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 shadow-xl">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-900">Processing transcription...</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-sm text-gray-600">
            <p className="mb-2">
              <span className="font-medium">iCloud Workflow:</span> Download transcripts and save to iCloud Drive to access on your iPhone
            </p>
            <p>
              Supported formats: MP3, WAV, M4A, AAC, FLAC, OGG • Maximum file size: 25MB per file
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
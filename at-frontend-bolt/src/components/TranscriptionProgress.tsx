import React, { useState } from 'react';
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  FileText, 
  Loader, 
  MoreVertical,
  Folder,
  FolderOpen,
  Download
} from 'lucide-react';
import { TranscriptionJob, TranscriptionGroup } from '../types';
import { formatFileSize, formatDuration } from '../utils/fileUtils';
import { JobGroupSelector } from './JobGroupSelector';

interface TranscriptionProgressProps {
  jobs: TranscriptionJob[];
  groups: TranscriptionGroup[];
  onJobSelect: (job: TranscriptionJob) => void;
  selectedJobId?: string;
  onAddJobToGroup: (groupId: string, jobId: string) => void;
  onRemoveJobFromGroup: (jobId: string) => void;
  onCreateGroup: (name: string) => void;
}

export const TranscriptionProgress: React.FC<TranscriptionProgressProps> = ({
  jobs,
  groups,
  onJobSelect,
  selectedJobId,
  onAddJobToGroup,
  onRemoveJobFromGroup,
  onCreateGroup
}) => {
  const [showGroupSelector, setShowGroupSelector] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | 'all' | 'ungrouped'>('all');

  const getStatusIcon = (status: TranscriptionJob['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'processing':
        return <Loader className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = (job: TranscriptionJob) => {
    switch (job.status) {
      case 'pending':
        return 'Queued for processing';
      case 'processing':
        return `Processing... ${job.progress}%`;
      case 'completed':
        return 'Transcription complete';
      case 'error':
        return `Error: ${job.error || 'Unknown error'}`;
    }
  };

  const getStatusColor = (status: TranscriptionJob['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-50 border-yellow-200';
      case 'processing':
        return 'bg-blue-50 border-blue-200';
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
    }
  };

  const getJobGroup = (job: TranscriptionJob) => {
    return groups.find(g => g.id === job.groupId);
  };

  const filteredJobs = jobs.filter(job => {
    if (groupFilter === 'all') return true;
    if (groupFilter === 'ungrouped') return !job.groupId;
    return job.groupId === groupFilter;
  });

  const handleGroupAssignment = (jobId: string, groupId: string | undefined) => {
    if (groupId) {
      onAddJobToGroup(groupId, jobId);
    } else {
      onRemoveJobFromGroup(jobId);
    }
    setShowGroupSelector(null);
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No transcription jobs</h3>
        <p className="text-gray-600">Upload audio files to start transcribing</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          Transcription Jobs ({filteredJobs.length})
        </h3>
        
        {/* Group Filter */}
        <div className="flex items-center space-x-2">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Jobs</option>
            <option value="ungrouped">Ungrouped</option>
            {groups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
          
          <div className="text-sm text-gray-500">
            {jobs.filter(j => j.status === 'completed').length} completed
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {filteredJobs.map((job) => {
          const jobGroup = getJobGroup(job);
          
          return (
            <div
              key={job.id}
              className={`cursor-pointer rounded-lg border p-4 transition-all duration-200 hover:shadow-md ${
                selectedJobId === job.id 
                  ? 'ring-2 ring-blue-500 ring-opacity-50' 
                  : ''
              } ${getStatusColor(job.status)}`}
            >
              <div className="flex items-start justify-between">
                <div 
                  className="flex items-start space-x-3 flex-1 min-w-0"
                  onClick={() => onJobSelect(job)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {getStatusIcon(job.status)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <h4 className="text-sm font-medium text-gray-900 truncate">
                        {job.audioFile.name}
                      </h4>
                      {jobGroup && (
                        <div className="flex items-center space-x-1">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: jobGroup.color }}
                          />
                          <span className="text-xs text-gray-600">{jobGroup.name}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-3 mt-1 text-xs text-gray-600">
                      <span>{formatFileSize(job.audioFile.size)}</span>
                      {job.audioFile.duration && (
                        <span>{formatDuration(job.audioFile.duration)}</span>
                      )}
                      <span>•</span>
                      <span>{job.createdAt.toLocaleString()}</span>
                    </div>
                    
                    <div className="mt-2">
                      <p className="text-sm text-gray-700">
                        {getStatusText(job)}
                      </p>
                      
                      {job.status === 'processing' && (
                        <div className="mt-2">
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      
                      {job.status === 'completed' && job.completedAt && (
                        <p className="text-xs text-gray-500 mt-1">
                          Completed {job.completedAt.toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                  {job.status === 'completed' && (
                    <div className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                      Ready
                    </div>
                  )}
                  
                  {/* Group Assignment Menu */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowGroupSelector(showGroupSelector === job.id ? null : job.id);
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                      title="Assign to group"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    
                    {showGroupSelector === job.id && (
                      <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-3">
                        <JobGroupSelector
                          groups={groups}
                          selectedGroupId={job.groupId}
                          onGroupSelect={(groupId) => handleGroupAssignment(job.id, groupId)}
                          onCreateGroup={onCreateGroup}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
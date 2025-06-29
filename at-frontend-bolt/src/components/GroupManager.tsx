import React, { useState } from 'react';
import { 
  Plus, 
  Edit3, 
  Trash2, 
  FolderPlus, 
  Users, 
  Calendar,
  Download,
  FileText
} from 'lucide-react';
import { TranscriptionGroup, TranscriptionJob, BatchExportOptions } from '../types';
import { downloadBatchTranscripts } from '../utils/fileUtils';

interface GroupManagerProps {
  groups: TranscriptionGroup[];
  jobs: TranscriptionJob[];
  onCreateGroup: (name: string, description?: string) => void;
  onUpdateGroup: (groupId: string, updates: Partial<TranscriptionGroup>) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddJobToGroup: (groupId: string, jobId: string) => void;
  onRemoveJobFromGroup: (jobId: string) => void;
}

export const GroupManager: React.FC<GroupManagerProps> = ({
  groups,
  jobs,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAddJobToGroup,
  onRemoveJobFromGroup
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      onCreateGroup(newGroupName.trim(), newGroupDescription.trim() || undefined);
      setNewGroupName('');
      setNewGroupDescription('');
      setShowCreateForm(false);
    }
  };

  const handleUpdateGroup = (groupId: string) => {
    if (newGroupName.trim()) {
      onUpdateGroup(groupId, {
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined
      });
      setEditingGroup(null);
      setNewGroupName('');
      setNewGroupDescription('');
    }
  };

  const startEditing = (group: TranscriptionGroup) => {
    setEditingGroup(group.id);
    setNewGroupName(group.name);
    setNewGroupDescription(group.description || '');
  };

  const getGroupJobs = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return [];
    return jobs.filter(job => group.jobIds.includes(job.id));
  };

  const getCompletedGroupJobs = (groupId: string) => {
    return getGroupJobs(groupId).filter(job => job.status === 'completed' && job.transcript);
  };

  const handleBatchDownload = (group: TranscriptionGroup) => {
    const completedJobs = getCompletedGroupJobs(group.id);
    if (completedJobs.length === 0) return;

    const options: BatchExportOptions = {
      format: 'zip',
      includeMetadata: true,
      separateFiles: true,
      groupName: group.name
    };

    downloadBatchTranscripts(completedJobs, options);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Task Groups</h3>
            <p className="text-sm text-gray-600 mt-1">
              Organize your transcription jobs into groups for better management
            </p>
          </div>
          
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Group
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Create Group Form */}
        {showCreateForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Create New Group</h4>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <textarea
                placeholder="Description (optional)"
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleCreateGroup}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create Group
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewGroupName('');
                    setNewGroupDescription('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Groups List */}
        {groups.length === 0 ? (
          <div className="text-center py-8">
            <FolderPlus className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No groups yet</h4>
            <p className="text-gray-600">Create your first group to organize transcription jobs</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const groupJobs = getGroupJobs(group.id);
              const completedJobs = getCompletedGroupJobs(group.id);
              
              return (
                <div
                  key={group.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                >
                  {editingGroup === group.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <textarea
                        value={newGroupDescription}
                        onChange={(e) => setNewGroupDescription(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      />
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => handleUpdateGroup(group.id)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingGroup(null);
                            setNewGroupName('');
                            setNewGroupDescription('');
                          }}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <div>
                            <h4 className="font-medium text-gray-900">{group.name}</h4>
                            {group.description && (
                              <p className="text-sm text-gray-600">{group.description}</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {completedJobs.length > 0 && (
                            <button
                              onClick={() => handleBatchDownload(group)}
                              className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Download all transcripts"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => startEditing(group)}
                            className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit group"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDeleteGroup(group.id)}
                            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete group"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <div className="flex items-center space-x-1">
                          <Users className="w-4 h-4" />
                          <span>{groupJobs.length} jobs</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <FileText className="w-4 h-4" />
                          <span>{completedJobs.length} completed</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>{group.createdAt.toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
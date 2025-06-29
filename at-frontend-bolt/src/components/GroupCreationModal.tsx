import React, { useState, useEffect } from 'react';
import { X, FolderPlus, Users } from 'lucide-react';

interface GroupCreationModalProps {
  isOpen: boolean;
  fileCount: number;
  onCreateGroup: (name: string, description?: string) => string;
  onSkip: () => void;
  onClose: () => void;
}

export const GroupCreationModal: React.FC<GroupCreationModalProps> = ({
  isOpen,
  fileCount,
  onCreateGroup,
  onSkip,
  onClose
}) => {
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Auto-suggest a group name based on current date/time
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
      setGroupName(`Audio Session - ${dateStr}`);
    }
  }, [isOpen]);

  const handleCreate = () => {
    if (groupName.trim()) {
      const groupId = onCreateGroup(groupName.trim(), groupDescription.trim() || undefined);
      setGroupName('');
      setGroupDescription('');
      onClose();
    }
  };

  const handleSkip = () => {
    setGroupName('');
    setGroupDescription('');
    onSkip();
    onClose();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && groupName.trim()) {
      handleCreate();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FolderPlus className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Create Group for Multiple Files
              </h3>
              <p className="text-sm text-gray-600">
                {fileCount} files uploaded
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <div className="flex items-center space-x-2 mb-3 p-3 bg-blue-50 rounded-lg">
              <Users className="w-4 h-4 text-blue-600" />
              <p className="text-sm text-blue-800">
                Organizing {fileCount} audio files into a group will make it easier to manage and download them together.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="groupName" className="block text-sm font-medium text-gray-700 mb-2">
                Group Name *
              </label>
              <input
                id="groupName"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="e.g., Meeting Notes, Interview Session, Lecture Series"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="groupDescription" className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                id="groupDescription"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="Add a description to help identify this group later..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Skip Grouping
          </button>
          <button
            onClick={handleCreate}
            disabled={!groupName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            Create Group & Continue
          </button>
        </div>
      </div>
    </div>
  );
};
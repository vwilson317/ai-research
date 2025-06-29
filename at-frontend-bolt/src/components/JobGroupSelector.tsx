import React, { useState } from 'react';
import { FolderPlus, Folder, Check } from 'lucide-react';
import { TranscriptionGroup } from '../types';

interface JobGroupSelectorProps {
  groups: TranscriptionGroup[];
  selectedGroupId?: string;
  onGroupSelect: (groupId: string | undefined) => void;
  onCreateGroup: (name: string) => void;
}

export const JobGroupSelector: React.FC<JobGroupSelectorProps> = ({
  groups,
  selectedGroupId,
  onGroupSelect,
  onCreateGroup
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      onCreateGroup(newGroupName.trim());
      setNewGroupName('');
      setShowCreateForm(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Assign to Group (Optional)
      </label>
      
      <div className="space-y-2">
        {/* No Group Option */}
        <button
          onClick={() => onGroupSelect(undefined)}
          className={`w-full flex items-center justify-between p-3 border rounded-lg transition-colors ${
            !selectedGroupId
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-gray-300" />
            <span>No Group</span>
          </div>
          {!selectedGroupId && <Check className="w-4 h-4" />}
        </button>

        {/* Existing Groups */}
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => onGroupSelect(group.id)}
            className={`w-full flex items-center justify-between p-3 border rounded-lg transition-colors ${
              selectedGroupId === group.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span>{group.name}</span>
            </div>
            {selectedGroupId === group.id && <Check className="w-4 h-4" />}
          </button>
        ))}

        {/* Create New Group */}
        {showCreateForm ? (
          <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateGroup()}
              />
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCreateGroup}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewGroupName('');
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full flex items-center justify-center space-x-2 p-3 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors text-gray-600"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Create New Group</span>
          </button>
        )}
      </div>
    </div>
  );
};
import { useState, useCallback } from 'react';
import { TranscriptionGroup } from '../types';

const GROUP_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
];

export const useTranscriptionGroups = () => {
  const [groups, setGroups] = useState<TranscriptionGroup[]>([]);

  const createGroup = useCallback((name: string, description?: string) => {
    const newGroup: TranscriptionGroup = {
      id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      createdAt: new Date(),
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      jobIds: []
    };

    setGroups(prev => [...prev, newGroup]);
    return newGroup;
  }, [groups.length]);

  const updateGroup = useCallback((groupId: string, updates: Partial<TranscriptionGroup>) => {
    setGroups(prev => prev.map(group => 
      group.id === groupId ? { ...group, ...updates } : group
    ));
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(group => group.id !== groupId));
  }, []);

  const addJobToGroup = useCallback((groupId: string, jobId: string) => {
    setGroups(prev => prev.map(group => 
      group.id === groupId 
        ? { ...group, jobIds: [...group.jobIds.filter(id => id !== jobId), jobId] }
        : { ...group, jobIds: group.jobIds.filter(id => id !== jobId) }
    ));
  }, []);

  const removeJobFromGroup = useCallback((jobId: string) => {
    setGroups(prev => prev.map(group => ({
      ...group,
      jobIds: group.jobIds.filter(id => id !== jobId)
    })));
  }, []);

  return {
    groups,
    createGroup,
    updateGroup,
    deleteGroup,
    addJobToGroup,
    removeJobFromGroup
  };
};
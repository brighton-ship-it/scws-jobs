'use client';

import { useState, useRef, useEffect } from 'react';
import { User } from '@/types/database';
import { Check, ChevronDown, X, UserPlus } from 'lucide-react';

interface TeamMemberMultiSelectProps {
  teamMembers: User[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TeamMemberMultiSelect({
  teamMembers,
  selectedIds,
  onChange,
  placeholder = 'Assign team members...',
  className = '',
  disabled = false,
}: TeamMemberMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedMembers = teamMembers.filter(m => selectedIds.includes(m.id));
  const filteredMembers = teamMembers.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleMember = (memberId: string) => {
    if (selectedIds.includes(memberId)) {
      onChange(selectedIds.filter(id => id !== memberId));
    } else {
      onChange([...selectedIds, memberId]);
    }
  };

  const removeMember = (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedIds.filter(id => id !== memberId));
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-700';
      case 'office': return 'bg-blue-100 text-blue-700';
      case 'field': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected Tags & Input */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`
          min-h-[42px] w-full px-3 py-2 rounded-lg border transition-colors cursor-pointer
          flex flex-wrap items-center gap-2
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:border-gray-400'}
          ${isOpen ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-300'}
        `}
      >
        {selectedMembers.length === 0 ? (
          <span className="text-gray-400 flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            {placeholder}
          </span>
        ) : (
          selectedMembers.map(member => (
            <span
              key={member.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-sm"
            >
              <span className="h-5 w-5 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-medium">
                {member.name.charAt(0)}
              </span>
              <span className="font-medium">{member.name.split(' ')[0]}</span>
              {!disabled && (
                <button
                  onClick={(e) => removeMember(member.id, e)}
                  className="hover:bg-green-200 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        )}
        <ChevronDown className={`h-4 w-4 text-gray-400 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team members..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              autoFocus
            />
          </div>

          {/* Member List */}
          <div className="overflow-y-auto max-h-48">
            {filteredMembers.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">No team members found</p>
            ) : (
              filteredMembers.map(member => {
                const isSelected = selectedIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors
                      ${isSelected ? 'bg-green-50' : ''}
                    `}
                  >
                    <div className="h-8 w-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-medium flex-shrink-0">
                      {member.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{member.name}</p>
                      <p className="text-xs text-gray-500">{member.phone}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${getRoleColor(member.role)}`}>
                      {member.role}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TeamMemberMultiSelect;

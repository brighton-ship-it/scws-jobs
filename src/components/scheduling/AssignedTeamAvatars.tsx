'use client';

import { User } from '@/types/database';

interface AssignedTeamAvatarsProps {
  users: User[];
  maxDisplay?: number;
  size?: 'sm' | 'md' | 'lg';
  showNames?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

const overlapClasses = {
  sm: '-ml-2',
  md: '-ml-2.5',
  lg: '-ml-3',
};

export function AssignedTeamAvatars({
  users,
  maxDisplay = 3,
  size = 'md',
  showNames = false,
  className = '',
}: AssignedTeamAvatarsProps) {
  if (users.length === 0) {
    return (
      <span className="text-gray-400 text-sm italic">Unassigned</span>
    );
  }

  const displayedUsers = users.slice(0, maxDisplay);
  const remainingCount = users.length - maxDisplay;

  const getAvatarColor = (index: number) => {
    const colors = [
      'bg-green-600',
      'bg-blue-600',
      'bg-purple-600',
      'bg-orange-600',
      'bg-pink-600',
      'bg-teal-600',
    ];
    return colors[index % colors.length];
  };

  return (
    <div className={`flex items-center ${className}`}>
      {/* Avatars */}
      <div className="flex items-center">
        {displayedUsers.map((user, index) => (
          <div
            key={user.id}
            className={`
              ${sizeClasses[size]} 
              ${index > 0 ? overlapClasses[size] : ''} 
              ${getAvatarColor(index)}
              rounded-full text-white flex items-center justify-center font-medium
              border-2 border-white shadow-sm
            `}
            title={user.name}
          >
            {user.name.charAt(0)}
          </div>
        ))}
        {remainingCount > 0 && (
          <div
            className={`
              ${sizeClasses[size]} 
              ${overlapClasses[size]}
              bg-gray-400 rounded-full text-white flex items-center justify-center font-medium
              border-2 border-white shadow-sm
            `}
            title={`${remainingCount} more`}
          >
            +{remainingCount}
          </div>
        )}
      </div>

      {/* Names */}
      {showNames && (
        <div className="ml-2 text-sm text-gray-600">
          {displayedUsers.map((user, index) => (
            <span key={user.id}>
              {user.name.split(' ')[0]}
              {index < displayedUsers.length - 1 && ', '}
            </span>
          ))}
          {remainingCount > 0 && ` +${remainingCount} more`}
        </div>
      )}
    </div>
  );
}

// Compact inline version for tables
export function AssignedTeamInline({ users, className = '' }: { users: User[]; className?: string }) {
  if (users.length === 0) {
    return <span className="text-gray-400 text-sm">—</span>;
  }

  if (users.length === 1) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="h-6 w-6 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-medium">
          {users[0].name.charAt(0)}
        </div>
        <span className="text-sm text-gray-900">{users[0].name}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex -space-x-2">
        {users.slice(0, 2).map((user, i) => (
          <div
            key={user.id}
            className={`h-6 w-6 rounded-full text-white text-xs flex items-center justify-center font-medium border-2 border-white ${
              i === 0 ? 'bg-green-600' : 'bg-blue-600'
            }`}
            title={user.name}
          >
            {user.name.charAt(0)}
          </div>
        ))}
        {users.length > 2 && (
          <div
            className="h-6 w-6 rounded-full bg-gray-400 text-white text-xs flex items-center justify-center font-medium border-2 border-white"
            title={`${users.length - 2} more`}
          >
            +{users.length - 2}
          </div>
        )}
      </div>
      <span className="text-sm text-gray-600">{users.length} assigned</span>
    </div>
  );
}

export default AssignedTeamAvatars;

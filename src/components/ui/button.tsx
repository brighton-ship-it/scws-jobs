import { ReactNode } from 'react';
import Link from 'next/link';
import { ButtonLoader } from '@/components/feedback/LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'link';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

// Jobber-style button variants
const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-emerald-600 text-white 
    hover:bg-emerald-700 
    focus:ring-emerald-500/20 
    shadow-sm hover:shadow
    active:bg-emerald-800
  `,
  secondary: `
    bg-gray-100 text-gray-700 
    hover:bg-gray-200 
    focus:ring-gray-500/20
    active:bg-gray-300
  `,
  outline: `
    border border-gray-200 bg-white text-gray-700 
    hover:bg-gray-50 hover:border-gray-300
    focus:ring-gray-500/20
    active:bg-gray-100
  `,
  ghost: `
    text-gray-600 
    hover:bg-gray-100 hover:text-gray-900 
    focus:ring-gray-500/20
    active:bg-gray-200
  `,
  danger: `
    bg-red-600 text-white 
    hover:bg-red-700 
    focus:ring-red-500/20 
    shadow-sm hover:shadow
    active:bg-red-800
  `,
  success: `
    bg-emerald-600 text-white 
    hover:bg-emerald-700 
    focus:ring-emerald-500/20 
    shadow-sm hover:shadow
    active:bg-emerald-800
  `,
  link: `
    text-emerald-600 
    hover:text-emerald-700 hover:underline
    focus:ring-emerald-500/20
    p-0
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1.5 text-xs gap-1.5',
  sm: 'px-3 py-2 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  href,
  type = 'button',
  onClick,
  fullWidth = false,
  leftIcon,
  rightIcon,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  
  const baseStyles = `
    inline-flex items-center justify-center font-medium rounded-lg
    transition-all duration-150
    focus:outline-none focus:ring-2 focus:ring-offset-0
    disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
  `;

  const combinedStyles = `
    ${baseStyles} 
    ${variantStyles[variant]} 
    ${variant !== 'link' ? sizeStyles[size] : 'text-sm'} 
    ${fullWidth ? 'w-full' : ''} 
    ${className}
  `.trim();

  const content = (
    <>
      {loading ? (
        <ButtonLoader className={variant === 'primary' || variant === 'danger' || variant === 'success' ? 'text-white' : 'text-gray-500'} />
      ) : leftIcon ? (
        <span className="flex-shrink-0">{leftIcon}</span>
      ) : null}
      <span>{children}</span>
      {rightIcon && !loading && <span className="flex-shrink-0">{rightIcon}</span>}
    </>
  );

  if (href && !isDisabled) {
    return (
      <Link href={href} className={combinedStyles}>
        {content}
      </Link>
    );
  }

  return (
    <button 
      className={combinedStyles} 
      disabled={isDisabled} 
      type={type}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

// Icon-only button variant
interface IconButtonProps {
  icon: ReactNode;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  label: string; // For accessibility
}

const iconButtonSizes = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-2.5',
};

const iconButtonVariants = {
  default: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200',
  ghost: 'text-gray-400 hover:text-gray-600 hover:bg-gray-50 active:bg-gray-100',
  outline: 'text-gray-500 hover:text-gray-700 border border-gray-200 hover:bg-gray-50 active:bg-gray-100',
};

export function IconButton({
  icon,
  variant = 'default',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  onClick,
  label,
}: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center rounded-lg transition-all
        focus:outline-none focus:ring-2 focus:ring-gray-500/20
        disabled:opacity-50 disabled:cursor-not-allowed
        ${iconButtonSizes[size]}
        ${iconButtonVariants[variant]}
        ${className}
      `}
      aria-label={label}
    >
      {loading ? <ButtonLoader /> : icon}
    </button>
  );
}

// Button group for related actions
export function ButtonGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`inline-flex rounded-lg shadow-sm ${className}`}>
      {children}
    </div>
  );
}

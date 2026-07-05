import React from 'react';
import './Button.css';

/**
 * Reusable Button component
 * @param {object} props
 * @param {React.ReactNode} props.children - Button content
 * @param {string} props.variant - Button variant ('primary', 'secondary', 'danger', 'accent')
 * @param {string} props.size - Button size ('sm', 'md', 'lg')
 * @param {function} props.onClick - Click handler
 * @param {boolean} props.disabled - Disabled state
 * @param {string} props.className - Additional CSS classes
 * @param {object} props.style - Inline styles
 */
const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  className = '',
  style = {},
  type = 'button',
  ...props
}) => {
  const buttonClasses = `btn btn-${variant} btn-${size} ${className}`.trim();

  return (
    <button
      type={type}
      className={buttonClasses}
      onClick={onClick}
      disabled={disabled}
      style={style}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;

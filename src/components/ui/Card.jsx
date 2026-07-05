import React from 'react';
import './Card.css';

/**
 * Reusable Card component
 * @param {object} props
 * @param {React.ReactNode} props.children - Card content
 * @param {string} props.className - Additional CSS classes
 * @param {object} props.style - Inline styles
 * @param {string} props.variant - Card variant ('default', 'elevated', 'outlined')
 */
const Card = ({
  children,
  className = '',
  style = {},
  variant = 'default',
  ...props
}) => {
  const cardClasses = `card card-${variant} ${className}`.trim();

  return (
    <div className={cardClasses} style={style} {...props}>
      {children}
    </div>
  );
};

export default Card;

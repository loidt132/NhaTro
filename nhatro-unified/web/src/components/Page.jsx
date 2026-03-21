import React from 'react';

// Simple responsive page container used across pages
export default function Page({ children, className = '' }) {
  // max-w-xl on small screens, expand on larger; comfortable padding
  return (
    <div className={`mx-auto w-full px-4 sm:px-6 lg:px-8 max-w-5xl ${className}`}>
      {children}
    </div>
  );
}

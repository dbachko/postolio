import React from 'react';

export function CreateCta({
  date,
  onClick,
  disabled,
}: {
  date: Date;
  onClick?: (d: Date) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="pc-create-cta"
      aria-label="Create post"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) {
          return;
        }
        onClick?.(date);
      }}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from './calendar';

describe('Calendar', () => {
  it('renders the month grid and reports the selected day', () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        mode="single"
        defaultMonth={new Date(2026, 0, 1)}
        selected={undefined}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByText('January 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /January 15/ }));

    expect(onSelect.mock.calls[0][0]).toEqual(new Date(2026, 0, 15));
  });
});

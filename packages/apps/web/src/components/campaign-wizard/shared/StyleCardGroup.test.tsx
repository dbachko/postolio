import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { StyleCardGroup } from './StyleCardGroup';

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <div>
      <StyleCardGroup value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </div>
  );
}

describe('StyleCardGroup', () => {
  it('keeps custom input separate from selected styles', () => {
    render(<Harness initial={['my custom']} />);

    const input = screen.getByPlaceholderText('Describe extra style…') as HTMLInputElement;
    expect(input.value).toBe('my custom');

    fireEvent.click(screen.getByText('Modern & Minimalist'));
    expect(input.value).toBe('my custom');

    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(['modern', 'my custom']));
  });

  it('appends custom style as the last array item and filters recognized values', () => {
    render(<Harness initial={[]} />);

    fireEvent.click(screen.getByText('Modern & Minimalist'));
    const input = screen.getByPlaceholderText('Describe extra style…') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'hand-drawn' } });
    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(['modern', 'hand-drawn']));
    expect(input.value).toBe('hand-drawn');

    // Custom text should not duplicate recognized style values.
    fireEvent.change(input, { target: { value: 'modern' } });
    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(['modern']));
    expect(input.value).toBe('');
  });

  it('allows spaces while typing custom style', () => {
    render(<Harness initial={[]} />);

    const input = screen.getByPlaceholderText('Describe extra style…') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'soft ' } });

    // Input keeps the trailing space so the user can continue typing.
    expect(input.value).toBe('soft ');

    // Stored value trims trailing whitespace.
    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(['soft']));

    fireEvent.change(input, { target: { value: 'soft pastels' } });
    expect(input.value).toBe('soft pastels');
    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(['soft pastels']));
  });
});

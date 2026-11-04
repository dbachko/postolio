import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSchedulingWebSocketState } from './useSchedulingWebSocketState';
it('preserves socket lifecycle references when connection state changes', () => {
  const { result } = renderHook(() => useSchedulingWebSocketState());
  const initialRefs = result.current.refs;
  act(() => result.current.state.setConnectionStatus('connected'));
  expect(result.current.refs).toBe(initialRefs);
  act(() => result.current.state.setRetryIn(1000));
  expect(result.current.refs).toBe(initialRefs);
});

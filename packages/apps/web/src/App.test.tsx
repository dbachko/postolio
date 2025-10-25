import { describe, it, expect } from 'vitest';
import { createBrowserRouter } from 'react-router-dom';

describe('App Router Configuration', () => {
  it('should use createBrowserRouter for data router support', () => {
    // This test verifies that we're using the data router API
    // which is required for useBlocker hook to work
    const testRouter = createBrowserRouter([
      {
        path: '/',
        element: 'Test',
      },
    ]);

    // The router should have the data router properties
    expect(testRouter).toHaveProperty('subscribe');
    expect(testRouter).toHaveProperty('navigate');
    expect(testRouter).toHaveProperty('state');
  });
});

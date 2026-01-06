# Real-time Updates

**Status**: Implemented (Issue #31)
**Last Updated**: 2026-01-05

## Overview

CanvasCollect uses WebSocket + Yjs for real-time collaboration, with polling as an optional fallback when sockets are disabled or for non-collab views.

## Architecture Decision

### Why a Hybrid Approach?

1. **WebSocket for collaboration**: Instant updates and shared cursors.
2. **Polling fallback**: Keeps simple canvases working without a persistent socket.
3. **Resilience**: If sockets drop, polling still keeps data fresh.
4. **Cost control**: Polling is only enabled when needed.

### Trade-offs

- **Latency**: 5-second delay vs instant WebSocket updates
- **Bandwidth**: Slight increase in API calls
- **Server Load**: Manageable with rate limiting and pagination

## Implementation

### WebSocket Collaboration

```typescript
import { useCollaboration } from '@/lib/hooks/use-collaboration';

const { doc, users, cursors, status } = useCollaboration({
  canvasId,
  userId,
  email,
  name,
});
```

### Polling Fallback Strategy

Polling is used only when explicitly enabled (for example, shared canvases without an active socket). The system uses the **Page Visibility API** to optimize polling frequency:

| Tab State | Polling Interval | Use Case |
|-----------|-----------------|----------|
| **Active** | 5 seconds | Real-time collaboration when user is actively working |
| **Inactive** | 30 seconds | Background sync when user switches tabs |
| **Disabled** | None | Private canvases that don't need real-time updates |

### How It Works

```typescript
import { useCanvasItemsWithPolling } from '@/lib/hooks/use-canvas-items';

function Canvas({ canvasId, isShared }) {
  // Automatically polls when canvas is shared
  const { data, isLoading } = useCanvasItemsWithPolling(canvasId, {
    enablePolling: isShared, // Only poll for shared canvases
    viewport: { minX, maxX, minY, maxY }, // Efficient viewport-based loading
  });

  // Component automatically receives updates every 5s (active) or 30s (inactive)
  return <div>{/* Render canvas items */}</div>;
}
```

### Page Visibility Detection

```typescript
// Internal implementation (hooks/use-canvas-items.ts)
function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
```

## Configuration

### Constants (`lib/constants.ts`)

```typescript
/**
 * Polling interval when tab is active
 * Default: 5000ms (5 seconds)
 */
export const POLLING_INTERVAL_ACTIVE_MS = 5000;

/**
 * Polling interval when tab is inactive
 * Default: 30000ms (30 seconds)
 */
export const POLLING_INTERVAL_INACTIVE_MS = 30000;

/**
 * Enable polling globally
 * Default: true
 */
export const ENABLE_COLLABORATIVE_POLLING = true;
```

### Environment Variables

You can disable polling globally via environment variable:

```bash
# .env
NEXT_PUBLIC_DISABLE_POLLING=true
```

## Usage Examples

### Basic Usage (Shared Canvas)

```typescript
import { useCanvasItemsWithPolling } from '@/lib/hooks/use-canvas-items';

function SharedCanvas({ canvasId }) {
  const { data, isLoading, error } = useCanvasItemsWithPolling(canvasId, {
    enablePolling: true, // Poll every 5s (active) / 30s (inactive)
  });

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return <Canvas items={data.items} />;
}
```

### Private Canvas (No Polling)

```typescript
function PrivateCanvas({ canvasId }) {
  // Disable polling for private canvases
  const { data } = useCanvasItemsWithPolling(canvasId, {
    enablePolling: false, // No polling, manual refetch only
  });

  return <Canvas items={data.items} />;
}
```

### Viewport-based Polling (Large Canvases)

```typescript
function LargeCanvas({ canvasId, viewport }) {
  // Only poll for items in current viewport
  const { data } = useCanvasItemsWithPolling(canvasId, {
    enablePolling: true,
    viewport: {
      minX: viewport.x,
      maxX: viewport.x + viewport.width,
      minY: viewport.y,
      maxY: viewport.y + viewport.height,
      limit: 100,
    },
  });

  return <Canvas items={data.items} />;
}
```

### Manual Refetch

```typescript
function CanvasWithRefresh({ canvasId }) {
  const { data, refetch } = useCanvasItemsWithPolling(canvasId);

  const handleManualRefresh = async () => {
    await refetch();
  };

  return (
    <>
      <Button onClick={handleManualRefresh}>Refresh Now</Button>
      <Canvas items={data.items} />
    </>
  );
}
```

## Performance Considerations

### Rate Limiting

Polling respects API rate limits:

- **Active tab**: 12 requests/minute (5s interval)
- **Inactive tab**: 2 requests/minute (30s interval)
- **Rate limit**: 100 requests/15 minutes (more than enough)

### Network Efficiency

1. **Viewport-based loading**: Only fetches visible items
2. **Optimistic updates**: Local updates don't wait for polling
3. **Stale-while-revalidate**: UI shows cached data during refetch
4. **Deduplication**: TanStack Query prevents duplicate requests

### Battery/Resource Optimization

- **Reduced polling when inactive**: 6x less frequent (30s vs 5s)
- **No polling when disabled**: Zero overhead for private canvases
- **Automatic cleanup**: Stops polling when component unmounts

## Monitoring

### Checking Polling Status

```typescript
function CanvasDebug({ canvasId }) {
  const query = useCanvasItemsWithPolling(canvasId, { enablePolling: true });

  return (
    <div>
      <p>Last updated: {new Date(query.dataUpdatedAt).toLocaleTimeString()}</p>
      <p>Is fetching: {query.isFetching ? 'Yes' : 'No'}</p>
      <p>Polling enabled: {query.refetchInterval !== false ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

### Logging Polling Activity

```typescript
useEffect(() => {
  if (query.isFetching) {
    console.log('[Polling] Fetching updates for canvas:', canvasId);
  }
}, [query.isFetching]);
```

## Future Enhancements

- Add presence-aware retry UI and reconnect telemetry.
- Track collaboration health metrics for multi-instance deployments.

## Troubleshooting

### Updates Not Appearing

1. **Check polling is enabled**: `enablePolling: true`
2. **Verify canvas is shared**: Only shared canvases need polling
3. **Check rate limits**: View browser network tab for 429 errors
4. **Clear cache**: `queryClient.invalidateQueries(['canvas-items'])`

### High Network Usage

1. **Disable polling for private canvases**: `enablePolling: false`
2. **Increase polling interval**: Modify `POLLING_INTERVAL_ACTIVE_MS`
3. **Use viewport filtering**: Only poll for visible items
4. **Check tab visibility**: Should reduce to 30s when inactive

### Performance Issues

1. **Limit viewport items**: Use `limit: 100` in viewport params
2. **Enable React.memo**: Prevent unnecessary re-renders
3. **Monitor polling frequency**: Should be 5s (active) / 30s (inactive)
4. **Check for duplicate queries**: Use TanStack Query DevTools

## Testing

### Manual Testing

1. Open two browser windows side-by-side
2. Edit a canvas item in window A
3. Watch window B update within 5 seconds
4. Switch window B to another tab
5. Edit in window A again
6. Switch back to window B - updates should appear within 30 seconds

### Unit Tests

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useCanvasItemsWithPolling } from '@/lib/hooks/use-canvas-items';

test('polls every 5 seconds when tab is active', async () => {
  const { result } = renderHook(() =>
    useCanvasItemsWithPolling('canvas-1', { enablePolling: true })
  );

  await waitFor(() => expect(result.current.data).toBeDefined());

  // Wait 5 seconds and check for refetch
  await new Promise((resolve) => setTimeout(resolve, 5100));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

## Related Documentation

- [Architecture Decisions (ADR-0005)](../architecture/adr/0005-state-management-policy.md) - State management with TanStack Query
- [API Documentation](./API.md) - Canvas Items API endpoints
- [Performance Guide](./PERFORMANCE.md) - Optimization strategies
- [Monitoring Guide](./MONITORING.md) - Observability and debugging

## References

- [TanStack Query: Polling/Refetching](https://tanstack.com/query/latest/docs/react/guides/window-focus-refetching)
- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Vercel Serverless Functions](https://vercel.com/docs/functions/serverless-functions)

---

**Issue**: #31 - WebSocket/Real-time Updates
**Implementation**: WebSocket primary with adaptive polling fallback
**Status**: Production Ready

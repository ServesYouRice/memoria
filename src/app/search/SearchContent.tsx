'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  StickyNote2Outlined as NoteIcon,
  BookmarkBorder as BookmarkIcon,
  ImageOutlined as ImageIcon,
  NotesOutlined as TextIcon,
  CategoryOutlined as OtherIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';

interface SearchResult {
  itemId: string;
  canvasId: string;
  canvasName: string;
  itemType: string;
  content: unknown;
  tags: string[];
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

const TYPE_META: Record<string, { label: string; icon: React.ReactElement }> = {
  NOTE: { label: 'Notes', icon: <NoteIcon /> },
  BOOKMARK: { label: 'Bookmarks', icon: <BookmarkIcon /> },
  IMAGE: { label: 'Images', icon: <ImageIcon /> },
  TEXT: { label: 'Text', icon: <TextIcon /> },
};

function typeMeta(itemType: string) {
  return TYPE_META[itemType] ?? { label: itemType, icon: <OtherIcon /> };
}

export function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Keep the URL shareable/deep-linkable as the query changes
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (debouncedQuery !== current) {
      const params = new URLSearchParams(searchParams.toString());
      if (debouncedQuery) params.set('q', debouncedQuery);
      else params.delete('q');
      router.replace(`/search${params.size ? `?${params}` : ''}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const enabled = debouncedQuery.trim().length >= 2;

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: async () => {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(debouncedQuery.trim())}`);
      if (!response.ok) throw new Error('Search failed');
      const json = await response.json();
      return (json.results ?? []) as SearchResult[];
    },
    enabled,
  });

  const results = useMemo(() => {
    const all = data ?? [];
    return typeFilter ? all.filter((r) => r.itemType === typeFilter) : all;
  }, [data, typeFilter]);

  const availableTypes = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.itemType))),
    [data]
  );

  return (
    <>
      <PageHeader title="Search" subtitle="Find notes, bookmarks, and items across all your canvases" />

      <TextField
        autoFocus
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your canvases… (min. 2 characters)"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: isFetching ? (
              <InputAdornment position="end">
                <CircularProgress size={20} />
              </InputAdornment>
            ) : undefined,
          },
        }}
        sx={{ mb: 2 }}
      />

      {availableTypes.length > 1 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Chip
            label="All"
            variant={typeFilter === null ? 'filled' : 'outlined'}
            color={typeFilter === null ? 'primary' : 'default'}
            onClick={() => setTypeFilter(null)}
          />
          {availableTypes.map((type) => (
            <Chip
              key={type}
              label={typeMeta(type).label}
              variant={typeFilter === type ? 'filled' : 'outlined'}
              color={typeFilter === type ? 'primary' : 'default'}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            />
          ))}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Search failed. Please try again.
        </Alert>
      )}

      {!enabled && (
        <EmptyState
          icon={SearchIcon}
          title="Search everything"
          description="Type at least two characters to search the content and tags of every item across your canvases — including canvases shared with you."
        />
      )}

      {enabled && !isFetching && !error && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title={`No results for “${debouncedQuery}”`}
          description="Try different keywords, or check the spelling."
        />
      )}

      {enabled && results.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {results.length} result{results.length === 1 ? '' : 's'}
          </Typography>
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <List disablePadding>
              {results.map((result) => (
                <ListItemButton
                  key={result.itemId}
                  divider
                  onClick={() => router.push(`/canvas/${result.canvasId}`)}
                  sx={{ py: 1.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 44, color: 'primary.main' }}>
                    {typeMeta(result.itemType).icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                        {result.snippet || 'Untitled item'}
                      </Typography>
                    }
                    secondary={
                      <Box
                        component="span"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}
                      >
                        <Typography component="span" variant="caption" color="text.secondary">
                          in <strong>{result.canvasName}</strong> • updated{' '}
                          {formatDistanceToNow(new Date(result.updatedAt), { addSuffix: true })}
                        </Typography>
                        {result.tags.slice(0, 4).map((tag) => (
                          <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ height: 18 }} />
                        ))}
                      </Box>
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </>
      )}
    </>
  );
}

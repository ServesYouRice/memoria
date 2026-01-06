'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Search as SearchIcon,
  Close as CloseIcon,
  Note as NoteIcon,
  Bookmark as BookmarkIcon,
} from '@mui/icons-material';
import { useDebounce } from '@/lib/hooks/use-debounce';

export interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

interface SearchResult {
  itemId: string;
  canvasId: string;
  canvasName: string;
  itemType: string;
  content: any;
  tags: string[];
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

export function GlobalSearchDialog({ open, onClose }: GlobalSearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalResults, setTotalResults] = useState(0);

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setTotalResults(0);
      return;
    }

    if (debouncedQuery.length < 2) {
      setResults([]);
      setTotalResults(0);
      return;
    }

    const searchItems = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data.results || []);
          setTotalResults(data.totalResults || 0);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    };

    searchItems();
  }, [debouncedQuery, open]);

  const handleResultClick = (result: SearchResult) => {
    router.push(`/canvas/${result.canvasId}`);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '60vh', maxHeight: '80vh' },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Search Across Canvases</Typography>
          <IconButton onClick={onClose} size="small" aria-label="Close search">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search notes and bookmarks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: loading ? (
              <InputAdornment position="end">
                <CircularProgress size={20} />
              </InputAdornment>
            ) : null,
          }}
          inputProps={{
            'aria-label': 'Search notes and bookmarks',
          }}
        />

        {query.length < 2 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Type at least 2 characters to search
            </Typography>
          </Box>
        )}

        {query.length >= 2 && totalResults === 0 && !loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No results found for &quot;{query}&quot;
            </Typography>
          </Box>
        )}

        {totalResults > 0 && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Found {totalResults} result{totalResults !== 1 ? 's' : ''}
            </Typography>
            <List sx={{ maxHeight: '50vh', overflow: 'auto' }}>
              {results.map((result, index) => (
                <React.Fragment key={result.itemId}>
                  {index > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton onClick={() => handleResultClick(result)}>
                      <Box sx={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          {result.itemType === 'NOTE' ? (
                            <NoteIcon fontSize="small" color="primary" />
                          ) : (
                            <BookmarkIcon fontSize="small" color="secondary" />
                          )}
                          <Typography variant="body2" color="text.secondary">
                            {result.canvasName}
                          </Typography>
                        </Box>
                        <ListItemText
                          primary={result.snippet}
                          secondary={
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                              {result.tags.map((tag) => (
                                <Chip key={tag} label={tag} size="small" variant="outlined" />
                              ))}
                            </Box>
                          }
                          primaryTypographyProps={{
                            sx: {
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            },
                          }}
                        />
                      </Box>
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

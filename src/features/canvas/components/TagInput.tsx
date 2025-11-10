'use client';

import React, { useState } from 'react';
import {
  Box,
  Chip,
  TextField,
  Stack,
  Autocomplete,
} from '@mui/material';

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  suggestions?: string[];
  size?: 'small' | 'medium';
}

export function TagInput({
  tags,
  onChange,
  placeholder = 'Add tags...',
  maxTags = 20,
  suggestions = [],
  size = 'small',
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleDelete = (tagToDelete: string) => {
    onChange(tags.filter((tag) => tag !== tagToDelete));
  };

  const handleAdd = (newTag: string | null) => {
    if (!newTag) return;

    const trimmedTag = newTag.trim();
    if (trimmedTag && !tags.includes(trimmedTag) && tags.length < maxTags) {
      onChange([...tags, trimmedTag]);
      setInputValue('');
    }
  };

  return (
    <Box>
      <Autocomplete
        multiple
        freeSolo
        size={size}
        value={tags}
        inputValue={inputValue}
        onInputChange={(_, value) => setInputValue(value)}
        onChange={(_, newValue) => {
          const uniqueTags = Array.from(new Set(newValue.map(v => v.trim()))).slice(0, maxTags);
          onChange(uniqueTags);
        }}
        options={suggestions}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              label={option}
              size="small"
              onDelete={() => handleDelete(option)}
              {...getTagProps({ index })}
              key={option}
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={tags.length === 0 ? placeholder : ''}
            variant="outlined"
            helperText={tags.length > 0 ? `${tags.length}/${maxTags} tags` : undefined}
          />
        )}
      />
    </Box>
  );
}

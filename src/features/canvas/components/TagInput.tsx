"use client";

import React, { useState } from "react";
import { Box, Chip, TextField, Autocomplete } from "@mui/material";

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  suggestions?: string[];
  size?: "small" | "medium";
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add tags...",
  maxTags = 20,
  suggestions = [],
  size = "small",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleDelete = (tagToDelete: string) => {
    onChange(tags.filter((tag) => tag !== tagToDelete));
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
          const uniqueTags = Array.from(
            new Set(newValue.map((v) => v.trim())),
          ).slice(0, maxTags);
          onChange(uniqueTags);
        }}
        options={suggestions}
        renderValue={(value, getItemProps) =>
          value.map((option, index) => {
            const { key, ...tagProps } = getItemProps({ index });
            return (
              <Chip
                key={key}
                label={option}
                size="small"
                {...tagProps}
                onDelete={() => handleDelete(option)}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={tags.length === 0 ? placeholder : ""}
            variant="outlined"
            helperText={
              tags.length > 0 ? `${tags.length}/${maxTags} tags` : undefined
            }
          />
        )}
      />
    </Box>
  );
}

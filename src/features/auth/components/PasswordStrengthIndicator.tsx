'use client';

import React from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { validatePasswordStrength } from '@/lib/validation/password';

interface PasswordStrengthIndicatorProps {
  password: string;
  userInputs?: string[];
}

const SCORE_COLORS = ['error', 'error', 'warning', 'success', 'success'] as const;
const SCORE_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'] as const;

export function PasswordStrengthIndicator({
  password,
  userInputs = [],
}: PasswordStrengthIndicatorProps) {
  if (!password) {
    return null;
  }

  const result = validatePasswordStrength(password, userInputs);
  const { score, feedback } = result;

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          Strength:
        </Typography>
        <Typography variant="caption" color={`${SCORE_COLORS[score]}.main`} fontWeight="medium">
          {SCORE_LABELS[score]}
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={(score / 4) * 100}
        color={SCORE_COLORS[score]}
        sx={{ height: 6, borderRadius: 1 }}
      />

      {feedback.warning && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
          {feedback.warning}
        </Typography>
      )}

      {feedback.suggestions.length > 0 && (
        <Box sx={{ mt: 1 }}>
          {feedback.suggestions.map((suggestion, index) => (
            <Typography key={index} variant="caption" color="text.secondary" display="block">
              • {suggestion}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

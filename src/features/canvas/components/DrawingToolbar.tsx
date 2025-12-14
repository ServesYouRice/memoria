
import React from 'react';
import { Paper, ToggleButton, ToggleButtonGroup, Stack, Divider, Slider, Box } from '@mui/material';
import { Create, Brush, Gesture } from '@mui/icons-material';
import { useCanvasStore } from '@/stores/canvasStore';

export type DrawingToolType = 'pen' | 'marker' | 'highlighter';

export const DrawingToolbar: React.FC = () => {
    const { drawingState, setDrawingState } = useCanvasStore();
    const { toolType, strokeWidth, color } = drawingState;

    const handleToolChange = (_: React.MouseEvent<HTMLElement>, newTool: DrawingToolType) => {
        if (newTool) {
            const updates: Partial<typeof drawingState> = { toolType: newTool };

            if (newTool === 'pen') updates.strokeWidth = 3;
            if (newTool === 'marker') updates.strokeWidth = 8;
            if (newTool === 'highlighter') {
                updates.strokeWidth = 15;
                updates.color = 'rgba(255, 255, 0, 0.5)';
            } else {
                updates.color = '#000000';
            }

            setDrawingState(updates);
        }
    };

    return (
        <Paper
            elevation={3}
            sx={{
                position: 'absolute',
                top: 20,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
                padding: 1,
                borderRadius: 2,
            }}
        >
            <Stack direction="row" spacing={2} divider={<Divider orientation="vertical" flexItem />}>
                <ToggleButtonGroup
                    value={toolType}
                    exclusive
                    onChange={handleToolChange}
                    size="small"
                >
                    <ToggleButton value="pen" aria-label="pen">
                        <Create fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="marker" aria-label="marker">
                        <Brush fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="highlighter" aria-label="highlighter">
                        <Gesture fontSize="small" />
                    </ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ width: 100, display: 'flex', alignItems: 'center' }}>
                    <Slider
                        size="small"
                        value={strokeWidth}
                        min={1}
                        max={30}
                        onChange={(_, value) => setDrawingState({ strokeWidth: value as number })}
                        aria-label="Stroke width"
                    />
                </Box>

                {/* Color Picker Placeholder */}
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <div
                        style={{
                            width: 24,
                            height: 24,
                            backgroundColor: color,
                            borderRadius: '50%',
                            border: '1px solid #ddd',
                            cursor: 'pointer'
                        }}
                        onClick={() => {/* Open Color Picker */ }}
                    />
                </Box>
            </Stack>
        </Paper>
    );
};

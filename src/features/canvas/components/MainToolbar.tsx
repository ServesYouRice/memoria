
import React from 'react';
import { Paper, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import {
    NearMe, // Select (Pointer)
    PanTool, // Pan (Hand)
    Edit, // Draw (Pencil)
    CropSquare, // Shape
    ArrowForward, // Arrow
    TextFields // Text
} from '@mui/icons-material';
import { useCanvasStore, CanvasTool } from '@/stores/canvasStore';

export const MainToolbar: React.FC = () => {
    const { activeTool, setActiveTool } = useCanvasStore();

    const handleToolChange = (_: React.MouseEvent<HTMLElement>, newTool: CanvasTool | null) => {
        if (newTool) {
            setActiveTool(newTool);
        }
    };

    return (
        <Paper
            elevation={3}
            sx={{
                position: 'absolute',
                left: 20,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 100,
                borderRadius: 2,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            <ToggleButtonGroup
                orientation="vertical"
                value={activeTool}
                exclusive
                onChange={handleToolChange}
                size="small"
            >
                <ToggleButton value="select" aria-label="Select">
                    <Tooltip title="Select (V)" placement="right">
                        <NearMe fontSize="small" />
                    </Tooltip>
                </ToggleButton>

                <ToggleButton value="pan" aria-label="Pan">
                    <Tooltip title="Pan (H)" placement="right">
                        <PanTool fontSize="small" />
                    </Tooltip>
                </ToggleButton>

                <ToggleButton value="draw" aria-label="Freehand Draw">
                    <Tooltip title="Draw (P)" placement="right">
                        <Edit fontSize="small" />
                    </Tooltip>
                </ToggleButton>

                <ToggleButton value="shape" aria-label="Add Shape">
                    <Tooltip title="Shape (R)" placement="right">
                        <CropSquare fontSize="small" />
                    </Tooltip>
                </ToggleButton>

                <ToggleButton value="arrow" aria-label="Add Arrow">
                    <Tooltip title="Arrow (A)" placement="right">
                        <ArrowForward fontSize="small" />
                    </Tooltip>
                </ToggleButton>

                <ToggleButton value="text" aria-label="Add Text">
                    <Tooltip title="Text (T)" placement="right">
                        <TextFields fontSize="small" />
                    </Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>
        </Paper>
    );
};

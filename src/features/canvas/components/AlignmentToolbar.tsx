import React from 'react';
import { Paper, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import {
    AlignHorizontalLeft,
    AlignHorizontalCenter,
    AlignHorizontalRight,
    AlignVerticalTop,
    AlignVerticalCenter,
    AlignVerticalBottom,
    ViewColumn,
    TableRows
} from '@mui/icons-material';

interface AlignmentToolbarProps {
    onAlign: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
    onDistribute: (type: 'horizontal' | 'vertical') => void;
}

export const AlignmentToolbar: React.FC<AlignmentToolbarProps> = ({ onAlign, onDistribute }) => {
    return (
        <Paper
            elevation={3}
            sx={{
                p: 0.5,
                borderRadius: 2,
                display: 'flex',
                gap: 1,
                bgcolor: 'background.paper',
            }}
        >
            <ToggleButtonGroup size="small" exclusive>
                <ToggleButton value="left" onClick={() => onAlign('left')}>
                    <Tooltip title="Align Left"><AlignHorizontalLeft fontSize="small" /></Tooltip>
                </ToggleButton>
                <ToggleButton value="center" onClick={() => onAlign('center')}>
                    <Tooltip title="Align Center"><AlignHorizontalCenter fontSize="small" /></Tooltip>
                </ToggleButton>
                <ToggleButton value="right" onClick={() => onAlign('right')}>
                    <Tooltip title="Align Right"><AlignHorizontalRight fontSize="small" /></Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup size="small" exclusive>
                <ToggleButton value="top" onClick={() => onAlign('top')}>
                    <Tooltip title="Align Top"><AlignVerticalTop fontSize="small" /></Tooltip>
                </ToggleButton>
                <ToggleButton value="middle" onClick={() => onAlign('middle')}>
                    <Tooltip title="Align Middle"><AlignVerticalCenter fontSize="small" /></Tooltip>
                </ToggleButton>
                <ToggleButton value="bottom" onClick={() => onAlign('bottom')}>
                    <Tooltip title="Align Bottom"><AlignVerticalBottom fontSize="small" /></Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup size="small" exclusive>
                <ToggleButton value="distribute-h" onClick={() => onDistribute('horizontal')}>
                    <Tooltip title="Distribute Horizontally"><ViewColumn fontSize="small" /></Tooltip>
                </ToggleButton>
                <ToggleButton value="distribute-v" onClick={() => onDistribute('vertical')}>
                    <Tooltip title="Distribute Vertically"><TableRows fontSize="small" /></Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>
        </Paper>
    );
};

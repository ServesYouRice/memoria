import React from 'react';
import { Box, Card, CardContent, CardHeader, Skeleton, Stack } from '@mui/material';

export const DashboardCardSkeleton = () => (
    <Card sx={{ height: '100%' }}>
        <CardHeader
            avatar={<Skeleton variant="circular" width={40} height={40} />}
            action={<Skeleton variant="circular" width={24} height={24} />}
            title={<Skeleton variant="text" width="60%" />}
            subheader={<Skeleton variant="text" width="40%" />}
        />
        <Skeleton variant="rectangular" height={140} />
        <CardContent>
            <Skeleton variant="text" />
            <Skeleton variant="text" width="80%" />
        </CardContent>
    </Card>
);

export const ItemSkeleton = () => (
    <Box sx={{ p: 2, border: '1px solid #eee', borderRadius: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
            <Skeleton variant="rectangular" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
            </Box>
        </Stack>
    </Box>
);

export const CommentSkeleton = () => (
    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Skeleton variant="circular" width={32} height={32} />
        <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Skeleton variant="text" width={100} height={20} />
                <Skeleton variant="text" width={60} height={20} />
            </Box>
            <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
        </Box>
    </Box>
);

import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Paper, Typography, CircularProgress } from '@mui/material';
import { socketService } from '../../services/socket';
import { updateStatsFromWebSocket } from '../../store/slices/statsSlice';
import { fetchStats } from '../../store/slices/statsSlice';
import ListAltIcon from '@mui/icons-material/ListAlt';
import StorageIcon from '@mui/icons-material/Storage';
import BoltIcon from '@mui/icons-material/Bolt';
import InventoryIcon from '@mui/icons-material/Inventory';
import ApiIcon from '@mui/icons-material/Api';

// Stats type to human-readable name and icon mapping
const statsTypeMeta = {
    queue: {
        label: 'Working Queue',
        icon: <ListAltIcon color="primary" sx={{ mr: 1 }} />,
    },
    entries: {
        label: 'Database Entries',
        icon: <StorageIcon color="secondary" sx={{ mr: 1 }} />,
    },
    api: {
        label: 'API Calls',
        icon: <ApiIcon color="info" sx={{ mr: 1 }} />,
    },
    cache: {
        label: 'Cache Hits',
        icon: <BoltIcon color="warning" sx={{ mr: 1 }} />,
    },
    cache_items: {
        label: 'Cache Items',
        icon: <InventoryIcon color="success" sx={{ mr: 1 }} />,
    },
};

const StatsCard = ({ title, stats }) => {
    const formatNumber = (num) => {
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);
    };

    // Filter out groups with no non-zero items
    const filteredStats = stats
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => item.value !== 0)
        }))
        .filter((group) => group.items.length > 0);

    if (filteredStats.length === 0) return null;

    return (
        <Box sx={{ mb: 2 }}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
                {title}
            </Typography>
            <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mt: 2
            }}>
                {filteredStats.map((group) => {
                    const meta = statsTypeMeta[group.type] || { label: group.type, icon: null };
                    return (
                        <Paper
                            key={group.type}
                            sx={{
                                flex: '1 1 250px',
                                minWidth: 220,
                                maxWidth: 300,
                                p: 2,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start'
                            }}
                            elevation={3}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                {meta.icon && meta.icon}
                                <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                                    {meta.label}
                                </Typography>
                            </Box>
                            {group.items.map((item, idx) => (
                                <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', py: 0.5 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        {item.name}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {formatNumber(item.value)}
                                    </Typography>
                                </Box>
                            ))}
                        </Paper>
                    );
                })}
            </Box>
        </Box>
    );
};

const SettingsStatistics = () => {
    const dispatch = useDispatch();
    const { providerStats, loading, error } = useSelector((state) => state.stats);

    useEffect(() => {
        // Initial fetch of stats
        dispatch(fetchStats());

        // Set up WebSocket listener for stats updates
        if (socketService.socket) {
            socketService.socket.on('stats_updated', (statsData) => {
                dispatch(updateStatsFromWebSocket(statsData));
            });
        }

        return () => {
            // Clean up WebSocket listener
            if (socketService.socket) {
                socketService.socket.off('stats_updated');
            }
        };
    }, [dispatch]);

    if (loading && providerStats.length === 0) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 0, sm: 3 } }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ p: 3 }}>
                <Typography color="error">Error loading stats: {error}</Typography>
            </Box>
        );
    }

    // Filter out providers with no non-zero stats
    const filteredProviders = providerStats.filter((provider) => {
        const filteredStats = provider.stats
            .map((group) => group.items.filter((item) => item.value !== 0))
            .filter((items) => items.length > 0);
        return filteredStats.length > 0;
    });

    return (
        <Box sx={{ p: { xs: 0, sm: 3 } }}>
            {filteredProviders.map((provider, index) => (
                <StatsCard
                    key={index}
                    title={provider.name}
                    stats={provider.stats}
                />
            ))}
        </Box>
    );
};

export default SettingsStatistics;

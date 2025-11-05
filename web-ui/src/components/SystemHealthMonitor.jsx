import React, { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { socketService } from '../services/socket';

const SystemHealthMonitor = () => {
    const [healthStatus, setHealthStatus] = useState({
        status: 'unknown',
        database: false,
        last_check: null,
        error: null
    });
    const [showAlert, setShowAlert] = useState(false);

    useEffect(() => {
        // Ensure socket is connected
        if (!socketService.socket) {
            socketService.connect();
        }

        const socket = socketService.socket;
        if (!socket) return;

        // Listen for health status updates
        socket.on('health_status', (status) => {
            setHealthStatus(status);
            // Show alert if status is unhealthy
            if (status.status === 'unhealthy') {
                setShowAlert(true);
            }
        });

        // Listen for disconnection
        socket.on('disconnect', () => {
            setHealthStatus({
                status: 'unhealthy',
                database: false,
                last_check: Date.now(),
                error: 'Connection to server lost'
            });
            setShowAlert(true);
        });

        // Listen for reconnection
        socket.on('connect', () => {
            setShowAlert(false);
        });

        return () => {
            // Clean up socket listeners
            if (socket) {
                socket.off('health_status');
                socket.off('disconnect');
                socket.off('connect');
            }
        };
    }, []);

    const handleCloseAlert = () => {
        setShowAlert(false);
    };

    return (
        <Snackbar
            open={showAlert}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            onClose={handleCloseAlert}
        >
            <Alert
                onClose={handleCloseAlert}
                severity={healthStatus.status === 'healthy' ? 'success' : 'error'}
                sx={{ width: '100%' }}
            >
                {healthStatus.error || 'System is currently unavailable. Please try again later.'}
            </Alert>
        </Snackbar>
    );
};

export default SystemHealthMonitor;

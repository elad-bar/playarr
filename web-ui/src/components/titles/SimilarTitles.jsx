import React from 'react';
import {
    Box,
    Card,
    CardContent,
    CardMedia,
    Typography,
    CircularProgress
} from '@mui/material';

const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const SimilarTitles = ({ titles, loading, onTitleClick }) => {
    if (loading) {
        return (
            <Box display="flex" justifyContent="center" p={2}>
                <CircularProgress />
            </Box>
        );
    }

    if (!titles || titles.length === 0) {
        return null;
    }

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 2,
                overflowX: 'auto',
                pb: 2,
                '&::-webkit-scrollbar': {
                    height: 8,
                },
                '&::-webkit-scrollbar-track': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 4,
                },
                '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: 4,
                    '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.3)',
                    },
                },
            }}
        >
            {titles.map((title) => (
                <Card
                    key={title.key}
                    sx={{
                        minWidth: 200,
                        maxWidth: 200,
                        bgcolor: 'rgba(255, 255, 255, 0.05)',
                        color: 'white',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background-color 0.2s',
                        '&:hover': {
                            bgcolor: 'rgba(255, 255, 255, 0.1)',
                            transform: 'scale(1.02)',
                        },
                    }}
                    onClick={() => onTitleClick(title)}
                >
                    <CardMedia
                        component="img"
                        height="300"
                        image={title.poster_path || PLACEHOLDER_IMAGE}
                        alt={title.name}
                        sx={{
                            objectFit: 'cover',
                        }}
                    />
                    <CardContent>
                        <Typography
                            variant="subtitle1"
                            component="div"
                            sx={{
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {title.name}
                        </Typography>
                        <Typography
                            variant="body2"
                            color="rgba(255, 255, 255, 0.7)"
                            sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {title.release_date ? new Date(title.release_date).getFullYear() : ''}
                        </Typography>
                    </CardContent>
                </Card>
            ))}
        </Box>
    );
};

export default SimilarTitles;

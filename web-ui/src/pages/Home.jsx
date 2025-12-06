import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import TitlesList from '../components/titles/TitlesList';
import ChannelsList from '../components/channels/ChannelsList';
import { updateFilters } from '../store/slices/titlesSlice';

const Home = () => {
    const dispatch = useDispatch();
    const { filters } = useSelector(state => state.titles);
    const location = useLocation();
    
    // Determine content mode from route
    const isVOD = location.pathname === '/media/vod';

    const handleSearchChange = (event) => {
        dispatch(updateFilters({ searchQuery: event.target.value }));
    };

    return (
        <Box>
            {isVOD ? (
                <TitlesList
                    searchQuery={filters.searchQuery}
                    onSearchChange={handleSearchChange}
                />
            ) : (
                <ChannelsList />
            )}
        </Box>
    );
};

export default Home;

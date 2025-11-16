import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '@mui/material';
import TitlesList from '../components/titles/TitlesList';
import ChannelsList from '../components/channels/ChannelsList';
import { updateFilters } from '../store/slices/titlesSlice';

const Home = ({ contentMode = 'vod' }) => {
    const dispatch = useDispatch();
    const { filters } = useSelector(state => state.titles);

    const handleSearchChange = (event) => {
        dispatch(updateFilters({ searchQuery: event.target.value }));
    };

    return (
        <Box>
            {contentMode === 'tv' ? (
                <ChannelsList />
            ) : (
                <TitlesList
                    searchQuery={filters.searchQuery}
                    onSearchChange={handleSearchChange}
                />
            )}
        </Box>
    );
};

export default Home;

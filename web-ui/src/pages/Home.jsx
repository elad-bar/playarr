import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '@mui/material';
import TitlesList from '../components/titles/TitlesList';
import { updateFilters } from '../store/slices/titlesSlice';

const Home = () => {
    const dispatch = useDispatch();
    const { filters } = useSelector(state => state.titles);

    const handleSearchChange = (event) => {
        dispatch(updateFilters({ searchQuery: event.target.value }));
    };

    return (
        <Box>
            <TitlesList
                searchQuery={filters.searchQuery}
                onSearchChange={handleSearchChange}
            />
        </Box>
    );
};

export default Home;

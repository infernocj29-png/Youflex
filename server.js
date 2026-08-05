const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '33ef7aaa3002731060f718f25dd995ac';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static static assets (index.html, images, CSS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   SECURE TMDB API PROXY ROUTES
============================================================ */

// Generic API Proxy Helper
const fetchTMDB = async (endpoint, queryParams = {}) => {
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    
    Object.keys(queryParams).forEach(key => {
        if (queryParams[key] !== undefined && key !== 'api_key') {
            url.searchParams.append(key, queryParams[key]);
        }
    });

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`TMDB responded with status ${response.status}`);
    }
    return await response.json();
};

// Route: Get Trending Media (Movies & TV)
app.get('/api/trending', async (req, res) => {
    try {
        const timeWindow = req.query.time_window || 'day';
        const data = await fetchTMDB(`/trending/all/${timeWindow}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch trending data', details: error.message });
    }
});

// Route: Discover Movies / TV by Category or Genre
app.get('/api/discover', async (req, res) => {
    try {
        const type = req.query.type === 'tv' ? 'tv' : 'movie';
        const data = await fetchTMDB(`/discover/${type}`, req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch category grid', details: error.message });
    }
});

// Route: Search Titles
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Query string "q" is required' });
        
        const data = await fetchTMDB('/search/multi', { query });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

// Route: Get Details for Specific Title
app.get('/api/details/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const data = await fetchTMDB(`/${type}/${id}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch details', details: error.message });
    }
});

// Route: Get Cast Credits
app.get('/api/credits/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const data = await fetchTMDB(`/${type}/${id}/credits`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch credits', details: error.message });
    }
});

// Route: Get TV Show Season Episodes
app.get('/api/tv/:id/season/:season', async (req, res) => {
    try {
        const { id, season } = req.params;
        const data = await fetchTMDB(`/tv/${id}/season/${season}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch episode data', details: error.message });
    }
});

// Fallback Route: Serve index.html for single-page client routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 YOUFLEX server running on http://localhost:${PORT}`);
});

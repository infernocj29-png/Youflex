const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// TMDB API Configuration
const TMDB_API_KEY = '33ef7aaa3002731060f718f25dd995ac';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory User Watchlist
let userWatchlist = [];

/* ============================================================
   HELPER FUNCTIONS
============================================================ */

// Formats TMDB API data to match the UI structure expected by index.html
function formatMovie(item) {
    return {
        id: item.id,
        title: item.title || item.name || 'Untitled',
        year: (item.release_date || item.first_air_date || 'N/A').split('-')[0],
        rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
        poster: item.poster_path 
            ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` 
            : 'https://via.placeholder.com/500x750?text=No+Poster',
        backdrop: item.backdrop_path 
            ? `${TMDB_IMAGE_BASE}/original${item.backdrop_path}` 
            : `${TMDB_IMAGE_BASE}/w500${item.poster_path}`,
        overview: item.overview || 'No description available.'
    };
}

/* ============================================================
   API ROUTES (LIVE TMDB INTEGRATION)
============================================================ */

// 1. Get Trending Movies Catalog (Live from TMDB)
app.get('/api/movies/trending', async (req, res) => {
    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/trending/movie/week?api_key=${TMDB_API_KEY}`
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.status_message || 'Failed to fetch trending movies');
        }

        const formattedMovies = data.results.map(formatMovie);

        res.json({
            success: true,
            movies: formattedMovies
        });
    } catch (error) {
        console.error('Error fetching trending catalog:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to load live catalog',
            error: error.message
        });
    }
});

// 2. Search Movies Endpoint (Live from TMDB)
app.get('/api/movies/search', async (req, res) => {
    const query = (req.query.query || '').trim();

    if (!query) {
        return res.json({ success: true, movies: [] });
    }

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.status_message || 'Search failed');
        }

        const formattedMovies = data.results.map(formatMovie);

        res.json({
            success: true,
            movies: formattedMovies
        });
    } catch (error) {
        console.error('Error searching movies:', error.message);
        res.status(500).json({
            success: false,
            message: 'Search request failed',
            error: error.message
        });
    }
});

// 3. Get Movie Trailer Video Key (Live YouTube Key from TMDB)
app.get('/api/movies/:id/trailer', async (req, res) => {
    const movieId = req.params.id;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${TMDB_API_KEY}`
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.status_message || 'Failed to fetch video trailers');
        }

        // Search for official YouTube trailer or teaser
        const trailer = data.results.find(
            video => video.site === 'YouTube' && (video.type === 'Trailer' || video.type === 'Teaser')
        );

        if (trailer) {
            res.json({
                success: true,
                youtubeKey: trailer.key
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'No official trailer found for this movie'
            });
        }
    } catch (error) {
        console.error(`Error fetching trailer for ID ${movieId}:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Error fetching trailer stream'
        });
    }
});

// 4. Get User Watchlist
app.get('/api/user/watchlist', (req, res) => {
    res.json({
        success: true,
        watchlist: userWatchlist
    });
});

// 5. Add / Remove Movie from Watchlist
app.post('/api/user/watchlist', (req, res) => {
    const { movie } = req.body;
    if (!movie || !movie.id) {
        return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    const index = userWatchlist.findIndex(item => item.id === movie.id);
    if (index > -1) {
        userWatchlist.splice(index, 1); // Remove
    } else {
        userWatchlist.push(movie); // Add
    }

    res.json({
        success: true,
        watchlist: userWatchlist
    });
});

// Serve frontend SPA for all unmatched routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🚀 YOUFLEX Server running at:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`=================================`);
});
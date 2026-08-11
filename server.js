const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from root directory (where index.html is located)
app.use(express.static(__dirname));

// TMDB Configuration
const TMDB_API_KEY = '33ef7aaa3002731060f718f25dd995ac';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const HERO_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

// Cache for API responses (5 minutes)
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

// Helper function for TMDB API calls with caching
async function tmdbFetch(endpoint, params = {}) {
    const cacheKey = `${endpoint}_${JSON.stringify(params)}`;
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    
    try {
        const url = new URL(`${TMDB_BASE}${endpoint}`);
        url.searchParams.set('api_key', TMDB_API_KEY);
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.set(key, params[key]);
            }
        });
        
        const response = await axios.get(url.toString(), {
            headers: {
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        
        cache.set(cacheKey, {
            data: response.data,
            timestamp: Date.now()
        });
        
        return response.data;
    } catch (error) {
        console.error(`TMDB API Error (${endpoint}):`, error.message);
        throw error;
    }
}

// Genre mapping
const GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action & Adventure",
    10765: "Sci-Fi & Fantasy", 10762: "Kids", 10763: "News", 10764: "Reality", 10766: "Soap",
    10767: "Talk", 10768: "War & Politics"
};

// Routes

// Get trending content for hero banner
app.get('/api/trending', async (req, res) => {
    try {
        const [trending, upcoming, nowPlaying] = await Promise.all([
            tmdbFetch('/trending/all/day'),
            tmdbFetch('/movie/upcoming'),
            tmdbFetch('/movie/now_playing')
        ]);
        
        const formatItems = (items, category, mediaType) => {
            return (items || [])
                .filter(item => item.backdrop_path && item.media_type !== 'person')
                .slice(0, 4)
                .map(item => ({
                    ...item,
                    media_type: mediaType || item.media_type || 'movie',
                    heroCategory: category
                }));
        };
        
        const heroItems = [
            ...formatItems(trending.results, 'trending'),
            ...formatItems(upcoming.results, 'upcoming', 'movie'),
            ...formatItems(nowPlaying.results, 'now-playing', 'movie')
        ];
        
        res.json({ success: true, data: heroItems });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get content by category
app.get('/api/content/:category', async (req, res) => {
    const { category } = req.params;
    const { page = 1, sort = 'popularity.desc', rating = 0, year = '', type = 'movie' } = req.query;
    
    try {
        let endpoint = '/discover/movie';
        let params = { page: parseInt(page), sort_by: sort };
        
        if (rating > 0) {
            params['vote_average.gte'] = parseFloat(rating);
        }
        if (year) {
            params['primary_release_year'] = parseInt(year);
        }
        
        switch(category) {
            case 'trending':
                endpoint = '/trending/all/week';
                params = { page: parseInt(page) };
                break;
            case 'tv':
                endpoint = '/discover/tv';
                params = { ...params, page: parseInt(page) };
                break;
            case 'movie':
                endpoint = '/discover/movie';
                params = { ...params, page: parseInt(page) };
                break;
            case 'upcoming':
                endpoint = '/movie/upcoming';
                params = { page: parseInt(page) };
                break;
            case 'now-playing':
                endpoint = '/movie/now_playing';
                params = { page: parseInt(page) };
                break;
            case 'top-rated':
                endpoint = `/discover/${type}`;
                params = { ...params, 'vote_count.gte': 200, page: parseInt(page) };
                break;
            case 'anime':
                endpoint = '/discover/tv';
                params = { with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc', page: parseInt(page) };
                break;
            case 'animation':
                endpoint = '/discover/movie';
                params = { with_genres: 16, sort_by: 'popularity.desc', page: parseInt(page) };
                break;
            default:
                endpoint = '/discover/movie';
                params = { page: parseInt(page), sort_by: 'popularity.desc' };
        }
        
        const data = await tmdbFetch(endpoint, params);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get content by genre
app.get('/api/genre/:genreId', async (req, res) => {
    const { genreId } = req.params;
    const { type = 'movie', page = 1, sort = 'popularity.desc' } = req.query;
    
    try {
        const data = await tmdbFetch(`/discover/${type}`, {
            with_genres: parseInt(genreId),
            page: parseInt(page),
            sort_by: sort
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get genres
app.get('/api/genres', async (req, res) => {
    const { type = 'movie' } = req.query;
    try {
        const data = await tmdbFetch(`/genre/${type}/list`);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all genres (movie + tv)
app.get('/api/genres/all', async (req, res) => {
    try {
        const [movieGenres, tvGenres] = await Promise.all([
            tmdbFetch('/genre/movie/list'),
            tmdbFetch('/genre/tv/list')
        ]);
        
        const merged = { ...GENRES };
        [...(movieGenres.genres || []), ...(tvGenres.genres || [])].forEach(g => {
            merged[g.id] = g.name;
        });
        
        res.json({ success: true, data: merged });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get movie/tv show details
app.get('/api/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    
    try {
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos,images,credits,similar,watch/providers'
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Search
app.get('/api/search', async (req, res) => {
    const { query, page = 1 } = req.query;
    
    if (!query || query.length < 2) {
        return res.json({ success: true, data: { results: [] } });
    }
    
    try {
        const data = await tmdbFetch('/search/multi', {
            query: query,
            page: parseInt(page)
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get watch providers
app.get('/api/providers/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        const data = await tmdbFetch(`/${type}/${id}/watch/providers`);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get similar content
app.get('/api/similar/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { page = 1 } = req.query;
    try {
        const data = await tmdbFetch(`/${type}/${id}/similar`, { page: parseInt(page) });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get credits
app.get('/api/credits/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        const data = await tmdbFetch(`/${type}/${id}/credits`);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get episodes for TV show
app.get('/api/episodes/:tvId/:season', async (req, res) => {
    const { tvId, season } = req.params;
    try {
        const data = await tmdbFetch(`/tv/${tvId}/season/${season}`);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get trailer URLs (fixed for direct playback)
app.get('/api/trailer/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    
    try {
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos'
        });
        
        const videos = data.videos?.results || [];
        const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                       videos.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                       videos.find(v => v.site === 'YouTube');
        
        if (trailer) {
            // Provide multiple formats for better compatibility
            res.json({
                success: true,
                data: {
                    key: trailer.key,
                    name: trailer.name,
                    embedUrl: `https://www.youtube.com/embed/${trailer.key}`,
                    embedUrlNoCookie: `https://www.youtube-nocookie.com/embed/${trailer.key}`,
                    embedUrlAutoplay: `https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`,
                    embedUrlNoCookieAutoplay: `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`
                }
            });
        } else {
            res.json({ success: false, error: 'No trailer found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get streaming sources (server-side proxy for better reliability)
app.get('/api/stream/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { season = 1, episode = 1 } = req.query;
    
    // Return multiple streaming sources with fallback options
    const sources = [];
    const baseSources = [
        'vidsrc.sbs',
        'vidsrc.to',
        'vidsrc.net',
        'vidsrc.xyz',
        'vidsrc.cc',
        'vidsrc.in',
        'vidsrc.me',
        'vidsrc.pm',
        'vidsrc.ws'
    ];
    
    const qualityParams = ['', '?quality=1080p', '&quality=1080p', '?q=1080', '&q=1080'];
    
    if (type === 'tv') {
        baseSources.forEach(source => {
            qualityParams.forEach(q => {
                sources.push({
                    url: `https://${source}/embed/tv/${id}/${season}/${episode}${q}`,
                    source: source,
                    quality: q.includes('1080') ? '1080p' : '720p',
                    type: 'tv'
                });
            });
        });
    } else {
        baseSources.forEach(source => {
            qualityParams.forEach(q => {
                sources.push({
                    url: `https://${source}/embed/movie/${id}${q}`,
                    source: source,
                    quality: q.includes('1080') ? '1080p' : '720p',
                    type: 'movie'
                });
            });
        });
    }
    
    res.json({
        success: true,
        data: {
            sources: sources,
            recommended: sources[0] || null
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📺 TMDB API connected successfully`);
    console.log(`📁 Serving files from: ${__dirname}`);
});

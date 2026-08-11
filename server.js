const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ API KEYS ============
const TMDB_API_KEY = process.env.TMDB_API_KEY || '33ef7aaa3002731060f718f25dd995ac';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

console.log('🚀 YOUFLEX Server Starting...');
console.log('📡 Environment:', process.env.NODE_ENV || 'development');
console.log('📡 Port:', PORT);
console.log('📡 TMDB API Key:', TMDB_API_KEY ? '✅ Configured' : '❌ Missing');

// ============ MIDDLEWARE ============
// Enable CORS for all origins (important for Render)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve static files from root directory
app.use(express.static(__dirname));

// ============ CONFIGURATION ============
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_DURATION = 5 * 60 * 1000;
const cache = new Map();

// ============ CACHING ============
function getCache(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

// ============ TMDB API ============
async function tmdbFetch(endpoint, params = {}, retries = 3) {
    const cacheKey = `tmdb_${endpoint}_${JSON.stringify(params)}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
            url.searchParams.set(key, params[key]);
        }
    });
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔄 Fetching ${endpoint} (attempt ${attempt})`);
            const response = await axios.get(url.toString(), {
                headers: { 'Accept': 'application/json' },
                timeout: 15000
            });
            setCache(cacheKey, response.data);
            console.log(`✅ Success: ${endpoint}`);
            return response.data;
        } catch (error) {
            console.error(`❌ Error (attempt ${attempt}):`, error.message);
            if (attempt === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

// ============ FALLBACK DATA ============
const FALLBACK_GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
};

const FALLBACK_HERO = {
    id: 550,
    title: "Fight Club",
    name: "Fight Club",
    media_type: "movie",
    heroCategory: "trending",
    backdrop_path: "/bptfVGEQuv6vDTIMVCHjJ9Dz8PX.jpg",
    poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
    vote_average: 8.8,
    overview: "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.",
    release_date: "1999-10-15"
};

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        tmdb: TMDB_API_KEY ? 'configured' : 'missing',
        youtube: YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE' ? 'configured' : 'not configured',
        server: 'running'
    });
});

// Get trending content
app.get('/api/trending', async (req, res) => {
    try {
        console.log('📡 Fetching trending content...');
        const [trending, upcoming, nowPlaying] = await Promise.all([
            tmdbFetch('/trending/all/day').catch(() => ({ results: [] })),
            tmdbFetch('/movie/upcoming').catch(() => ({ results: [] })),
            tmdbFetch('/movie/now_playing').catch(() => ({ results: [] }))
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
        
        if (heroItems.length === 0) {
            console.log('⚠️ No trending items found, using fallback');
            return res.json({ success: true, data: [FALLBACK_HERO] });
        }
        
        console.log(`✅ Found ${heroItems.length} trending items`);
        res.json({ success: true, data: heroItems });
    } catch (error) {
        console.error('❌ Trending Error:', error.message);
        res.json({ success: true, data: [FALLBACK_HERO] });
    }
});

// Get content by category
app.get('/api/content/:category', async (req, res) => {
    const { category } = req.params;
    const { page = 1, sort = 'popularity.desc', rating = 0, year = '', type = 'movie' } = req.query;
    
    try {
        console.log(`📡 Fetching content for category: ${category}`);
        let endpoint = '/discover/movie';
        let params = { page: parseInt(page), sort_by: sort };
        
        if (rating > 0) params['vote_average.gte'] = parseFloat(rating);
        if (year) params['primary_release_year'] = parseInt(year);
        
        switch(category) {
            case 'trending':
                endpoint = '/trending/all/week';
                params = { page: parseInt(page) };
                break;
            case 'tv':
                endpoint = '/discover/tv';
                break;
            case 'movie':
                endpoint = '/discover/movie';
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
                params = { ...params, 'vote_count.gte': 200 };
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
        console.log(`✅ Found ${data.results?.length || 0} items for ${category}`);
        res.json({ success: true, data });
    } catch (error) {
        console.error(`❌ Content Error (${category}):`, error.message);
        res.json({ 
            success: true, 
            data: { results: [], page: 1, total_pages: 0, total_results: 0 }
        });
    }
});

// Get all genres
app.get('/api/genres/all', async (req, res) => {
    try {
        console.log('📡 Fetching all genres...');
        const [movieGenres, tvGenres] = await Promise.all([
            tmdbFetch('/genre/movie/list').catch(() => ({ genres: [] })),
            tmdbFetch('/genre/tv/list').catch(() => ({ genres: [] }))
        ]);
        
        const merged = { ...FALLBACK_GENRES };
        [...(movieGenres.genres || []), ...(tvGenres.genres || [])].forEach(g => {
            merged[g.id] = g.name;
        });
        
        console.log(`✅ Loaded ${Object.keys(merged).length} genres`);
        res.json({ success: true, data: merged });
    } catch (error) {
        console.error('❌ Genres Error:', error.message);
        res.json({ success: true, data: FALLBACK_GENRES });
    }
});

// Get genres
app.get('/api/genres', async (req, res) => {
    const { type = 'movie' } = req.query;
    try {
        const data = await tmdbFetch(`/genre/${type}/list`);
        res.json({ success: true, data });
    } catch (error) {
        const fallbackGenres = Object.keys(FALLBACK_GENRES).map(id => ({
            id: parseInt(id),
            name: FALLBACK_GENRES[id]
        }));
        res.json({ success: true, data: { genres: fallbackGenres } });
    }
});

// Get movie/tv show details
app.get('/api/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        console.log(`📡 Fetching details for ${type}/${id}`);
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos,images,credits,similar,watch/providers'
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error(`❌ Details Error:`, error.message);
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
        console.log(`🔍 Searching for: ${query}`);
        const data = await tmdbFetch('/search/multi', {
            query: query,
            page: parseInt(page)
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error(`❌ Search Error:`, error.message);
        res.json({ success: true, data: { results: [] } });
    }
});

// Get trailer
app.get('/api/trailer/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        console.log(`📡 Fetching trailer for ${type}/${id}`);
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos'
        });
        
        const videos = data.videos?.results || [];
        const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                       videos.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                       videos.find(v => v.site === 'YouTube');
        
        if (trailer) {
            console.log(`✅ Found trailer: ${trailer.name}`);
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
            console.log('❌ No trailer found');
            res.json({ success: false, error: 'No trailer found' });
        }
    } catch (error) {
        console.error(`❌ Trailer Error:`, error.message);
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
        res.json({ success: true, data: { cast: [] } });
    }
});

// Get episodes
app.get('/api/episodes/:tvId/:season', async (req, res) => {
    const { tvId, season } = req.params;
    try {
        const data = await tmdbFetch(`/tv/${tvId}/season/${season}`);
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { episodes: [] } });
    }
});

// Get providers
app.get('/api/providers/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        const data = await tmdbFetch(`/${type}/${id}/watch/providers`);
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { results: {} } });
    }
});

// Get similar
app.get('/api/similar/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { page = 1 } = req.query;
    try {
        const data = await tmdbFetch(`/${type}/${id}/similar`, { page: parseInt(page) });
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { results: [] } });
    }
});

// Get streaming sources
app.get('/api/stream/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { season = 1, episode = 1 } = req.query;
    
    const sources = [];
    const baseSources = ['vidsrc.sbs', 'vidsrc.to', 'vidsrc.net', 'vidsrc.xyz', 'vidsrc.cc'];
    const qualityParams = ['', '?quality=1080p', '&quality=1080p'];
    
    if (type === 'tv') {
        baseSources.forEach(source => {
            qualityParams.forEach(q => {
                sources.push({
                    url: `https://${source}/embed/tv/${id}/${season}/${episode}${q}`,
                    source: source,
                    quality: q.includes('1080') ? '1080p' : '720p'
                });
            });
        });
    } else {
        baseSources.forEach(source => {
            qualityParams.forEach(q => {
                sources.push({
                    url: `https://${source}/embed/movie/${id}${q}`,
                    source: source,
                    quality: q.includes('1080') ? '1080p' : '720p'
                });
            });
        });
    }
    
    res.json({ success: true, data: { sources, recommended: sources[0] || null } });
});

// ============ SERVE INDEX.HTML ============
app.get('/', (req, res) => {
    console.log('📄 Serving index.html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ START SERVER ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 YOUFLEX Server running!`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    console.log(`📡 TMDB API: ${TMDB_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

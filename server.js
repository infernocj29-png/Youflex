require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ API KEYS ============
const TMDB_API_KEY = process.env.TMDB_API_KEY || '33ef7aaa3002731060f718f25dd995ac';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyCxCmXs4P4P8SenCmTlj5eawG4ccNP2FEg';

console.log('🚀 YOUFLEX Server Starting...');
console.log('📡 TMDB API:', TMDB_API_KEY ? '✅ Configured' : '❌ Missing');
console.log('🎬 YouTube API:', YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE' ? '✅ Configured' : '❌ Not configured');
console.log('🎬 YouTube Key:', YOUTUBE_API_KEY.substring(0, 15) + '...');

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============ CONFIGURATION ============
const TMDB_BASE = 'https://api.themoviedb.org/3';
const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';
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

// ============ YOUTUBE API ============
async function youtubeFetch(endpoint, params = {}, retries = 2) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
        console.warn('⚠️ YouTube API key not configured');
        return null;
    }
    
    const cacheKey = `youtube_${endpoint}_${JSON.stringify(params)}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;
    
    const url = new URL(`${YOUTUBE_BASE}${endpoint}`);
    url.searchParams.set('key', YOUTUBE_API_KEY);
    Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
            url.searchParams.set(key, params[key]);
        }
    });
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔄 YouTube: ${endpoint}`);
            const response = await axios.get(url.toString(), {
                headers: { 'Accept': 'application/json' },
                timeout: 10000
            });
            setCache(cacheKey, response.data);
            console.log(`✅ YouTube success: ${endpoint}`);
            return response.data;
        } catch (error) {
            console.error(`❌ YouTube error (attempt ${attempt}):`, error.message);
            if (error.response) {
                console.error('📊 YouTube API Response:', error.response.data);
            }
            if (attempt === retries) return null;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        services: {
            tmdb: 'connected',
            youtube: YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE' ? 'configured' : 'not configured'
        }
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
        
        res.json({ success: true, data: heroItems });
    } catch (error) {
        console.error('❌ Trending Error:', error.message);
        res.json({ success: true, data: [] });
    }
});

// Get content by category
app.get('/api/content/:category', async (req, res) => {
    const { category } = req.params;
    const { page = 1, sort = 'popularity.desc', rating = 0, year = '', type = 'movie' } = req.query;
    
    try {
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
        res.json({ success: true, data });
    } catch (error) {
        console.error(`❌ Content Error (${category}):`, error.message);
        res.json({ success: true, data: { results: [], page: 1, total_pages: 0 } });
    }
});

// Get all genres
app.get('/api/genres/all', async (req, res) => {
    try {
        const [movieGenres, tvGenres] = await Promise.all([
            tmdbFetch('/genre/movie/list').catch(() => ({ genres: [] })),
            tmdbFetch('/genre/tv/list').catch(() => ({ genres: [] }))
        ]);
        
        const merged = {};
        [...(movieGenres.genres || []), ...(tvGenres.genres || [])].forEach(g => {
            merged[g.id] = g.name;
        });
        
        res.json({ success: true, data: merged });
    } catch (error) {
        res.json({ success: true, data: {} });
    }
});

// Get genres by type
app.get('/api/genres', async (req, res) => {
    const { type = 'movie' } = req.query;
    try {
        const data = await tmdbFetch(`/genre/${type}/list`);
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { genres: [] } });
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
        const data = await tmdbFetch('/search/multi', {
            query: query,
            page: parseInt(page)
        });
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { results: [] } });
    }
});

// Get trailer from TMDB (with YouTube fallback)
app.get('/api/trailer/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        // First try TMDB
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos'
        });
        const videos = data.videos?.results || [];
        let trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                      videos.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                      videos.find(v => v.site === 'YouTube');
        
        if (trailer) {
            return res.json({
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
        }
        
        // If no TMDB trailer, try YouTube API
        if (YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
            const title = data.title || data.name;
            const year = (data.release_date || data.first_air_date || '').split('-')[0];
            
            // Try multiple search queries
            const queries = [
                `${title} ${year} official trailer`,
                `${title} official trailer`,
                `${title} trailer`,
                `${title} ${year} movie trailer`
            ];
            
            for (const query of queries) {
                const youtubeData = await youtubeFetch('/search', {
                    q: query,
                    part: 'snippet',
                    maxResults: 3,
                    type: 'video',
                    videoEmbeddable: 'true'
                });
                
                if (youtubeData && youtubeData.items && youtubeData.items.length > 0) {
                    const video = youtubeData.items.find(v => 
                        v.snippet.title.toLowerCase().includes('official') ||
                        v.snippet.title.toLowerCase().includes('trailer')
                    ) || youtubeData.items[0];
                    
                    return res.json({
                        success: true,
                        data: {
                            key: video.id.videoId,
                            name: video.snippet.title,
                            embedUrl: `https://www.youtube.com/embed/${video.id.videoId}`,
                            embedUrlNoCookie: `https://www.youtube-nocookie.com/embed/${video.id.videoId}`,
                            embedUrlAutoplay: `https://www.youtube.com/embed/${video.id.videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`,
                            embedUrlNoCookieAutoplay: `https://www.youtube-nocookie.com/embed/${video.id.videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`
                        }
                    });
                }
            }
        }
        
        res.json({ success: false, error: 'No trailer found' });
    } catch (error) {
        console.error('❌ Trailer Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// YouTube Search
app.get('/api/youtube/search', async (req, res) => {
    const { q, maxResults = 5 } = req.query;
    if (!q || q.length < 2) {
        return res.json({ success: true, data: { items: [] } });
    }
    try {
        const data = await youtubeFetch('/search', {
            q: q,
            part: 'snippet',
            maxResults: parseInt(maxResults),
            type: 'video',
            videoEmbeddable: 'true'
        });
        if (data && data.items) {
            const videos = data.items.map(item => ({
                id: item.id.videoId,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
                channelTitle: item.snippet.channelTitle,
                embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`
            }));
            res.json({ success: true, data: { items: videos } });
        } else {
            res.json({ success: true, data: { items: [] } });
        }
    } catch (error) {
        console.error('❌ YouTube Search Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get YouTube video details
app.get('/api/youtube/video/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const data = await youtubeFetch('/videos', {
            id: id,
            part: 'snippet,statistics,contentDetails'
        });
        if (data && data.items && data.items.length > 0) {
            const video = data.items[0];
            res.json({
                success: true,
                data: {
                    id: video.id,
                    title: video.snippet.title,
                    channelTitle: video.snippet.channelTitle,
                    viewCount: video.statistics?.viewCount || '0',
                    likeCount: video.statistics?.likeCount || '0',
                    embedUrl: `https://www.youtube.com/embed/${video.id}`
                }
            });
        } else {
            res.json({ success: false, error: 'Video not found' });
        }
    } catch (error) {
        console.error('❌ YouTube Video Error:', error.message);
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

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 YOUFLEX Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📡 TMDB API: ${TMDB_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🎬 YouTube API: ${YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE' ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🎬 YouTube Key: ${YOUTUBE_API_KEY.substring(0, 15)}...`);
    console.log(`\n💡 Test trailer with: http://localhost:${PORT}/api/trailer/movie/550`);
});

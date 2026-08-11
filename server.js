const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ API KEYS ============
const TMDB_API_KEY = process.env.TMDB_API_KEY || '33ef7aaa3002731060f718f25dd995ac';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyCxCmXs4P4P8SenCmTlj5eawG4ccNP2FEg';

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

console.log('🚀 YOUFLEX Server Starting...');
console.log(`📡 TMDB API: ${TMDB_API_KEY.substring(0, 8)}...`);
console.log(`🎬 YouTube API: ${YOUTUBE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);

// ============ CONFIGURATION ============
const TMDB_BASE = 'https://api.themoviedb.org/3';
const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';
const CACHE_DURATION = 5 * 60 * 1000;
const cache = new Map();

// ============ CACHING HELPER ============
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

// ============ TMDB API HELPER ============
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
            const response = await axios.get(url.toString(), {
                headers: { 'Accept': 'application/json', 'User-Agent': 'YOUFLEX/1.0' },
                timeout: 15000
            });
            setCache(cacheKey, response.data);
            return response.data;
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

// ============ YOUTUBE API HELPER ============
async function youtubeFetch(endpoint, params = {}, retries = 2) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
        console.warn('⚠️ YouTube API key not configured. Using fallback search.');
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
            const response = await axios.get(url.toString(), {
                headers: { 'Accept': 'application/json' },
                timeout: 10000
            });
            setCache(cacheKey, response.data);
            return response.data;
        } catch (error) {
            console.error(`YouTube API Error (attempt ${attempt}):`, error.message);
            if (attempt === retries) return null;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

// ============ YOUTUBE SEARCH FUNCTIONS ============

// Search for trailer by movie/TV show title
async function searchYouTubeTrailer(title, year = '', type = 'movie') {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
        return null;
    }
    
    try {
        const searchTerms = `${title} ${year} ${type} trailer`;
        console.log(`🔍 Searching YouTube for: "${searchTerms}"`);
        
        const data = await youtubeFetch('/search', {
            q: searchTerms,
            part: 'snippet',
            maxResults: 3,
            type: 'video',
            videoCategoryId: '1', // Film & Animation
            videoEmbeddable: 'true',
            order: 'relevance'
        });
        
        if (data && data.items && data.items.length > 0) {
            const videoId = data.items[0].id.videoId;
            const videoTitle = data.items[0].snippet.title;
            const thumbnail = data.items[0].snippet.thumbnails.high?.url || 
                            data.items[0].snippet.thumbnails.default?.url;
            
            // Get more details about the video
            const videoDetails = await youtubeFetch('/videos', {
                id: videoId,
                part: 'snippet,statistics,contentDetails'
            });
            
            const details = videoDetails?.items?.[0] || {};
            
            return {
                key: videoId,
                title: videoTitle,
                thumbnail: thumbnail,
                channelTitle: details.snippet?.channelTitle || '',
                viewCount: details.statistics?.viewCount || '0',
                likeCount: details.statistics?.likeCount || '0',
                duration: details.contentDetails?.duration || '',
                embedUrl: `https://www.youtube.com/embed/${videoId}`,
                embedUrlNoCookie: `https://www.youtube-nocookie.com/embed/${videoId}`,
                embedUrlAutoplay: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`,
                embedUrlNoCookieAutoplay: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`
            };
        }
        return null;
    } catch (error) {
        console.error('YouTube search error:', error.message);
        return null;
    }
}

// Search for official trailer by TMDB ID
async function searchYouTubeOfficialTrailer(tmdbId, title, year, type = 'movie') {
    // Try multiple search variations
    const searches = [
        `${title} ${year} official trailer`,
        `${title} official trailer ${year}`,
        `${title} trailer`,
        `${title} ${year} movie trailer`
    ];
    
    for (const searchTerm of searches) {
        try {
            const data = await youtubeFetch('/search', {
                q: searchTerm,
                part: 'snippet',
                maxResults: 2,
                type: 'video',
                videoCategoryId: '1',
                videoEmbeddable: 'true',
                order: 'relevance'
            });
            
            if (data && data.items && data.items.length > 0) {
                // Check if video title contains "official" or "trailer"
                const video = data.items[0];
                const videoTitle = video.snippet.title.toLowerCase();
                
                // Prefer videos with "official" or "official trailer" in title
                if (videoTitle.includes('official') || videoTitle.includes('trailer')) {
                    const videoId = video.id.videoId;
                    return {
                        key: videoId,
                        title: video.snippet.title,
                        thumbnail: video.snippet.thumbnails.high?.url || 
                                  video.snippet.thumbnails.default?.url,
                        embedUrl: `https://www.youtube.com/embed/${videoId}`,
                        embedUrlNoCookie: `https://www.youtube-nocookie.com/embed/${videoId}`,
                        embedUrlAutoplay: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`,
                        embedUrlNoCookieAutoplay: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`
                    };
                }
            }
        } catch (error) {
            // Continue to next search term
            continue;
        }
    }
    return null;
}

// Get related videos (for recommendations)
async function getRelatedVideos(videoId) {
    try {
        const data = await youtubeFetch('/search', {
            relatedToVideoId: videoId,
            part: 'snippet',
            maxResults: 10,
            type: 'video',
            videoEmbeddable: 'true'
        });
        
        if (data && data.items) {
            return data.items.map(item => ({
                id: item.id.videoId,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.high?.url || 
                          item.snippet.thumbnails.default?.url,
                channelTitle: item.snippet.channelTitle
            }));
        }
        return [];
    } catch (error) {
        console.error('Related videos error:', error.message);
        return [];
    }
}

// Get video comments
async function getVideoComments(videoId) {
    try {
        const data = await youtubeFetch('/commentThreads', {
            videoId: videoId,
            part: 'snippet',
            maxResults: 20,
            order: 'relevance'
        });
        
        if (data && data.items) {
            return data.items.map(item => ({
                text: item.snippet.topLevelComment.snippet.textDisplay,
                author: item.snippet.topLevelComment.snippet.authorDisplayName,
                publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
                likeCount: item.snippet.topLevelComment.snippet.likeCount
            }));
        }
        return [];
    } catch (error) {
        console.error('Comments error:', error.message);
        return [];
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

// Get trending content (with YouTube trailers)
app.get('/api/trending', async (req, res) => {
    try {
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
        
        // Fetch trailers for hero items
        const heroItemsWithTrailers = await Promise.all(
            heroItems.map(async (item) => {
                const title = item.title || item.name;
                const year = (item.release_date || item.first_air_date || '').split('-')[0];
                const type = item.media_type === 'tv' ? 'tv' : 'movie';
                
                // Try to get trailer from YouTube API
                let trailer = null;
                if (YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
                    trailer = await searchYouTubeTrailer(title, year, type);
                }
                
                return {
                    ...item,
                    trailer: trailer
                };
            })
        );
        
        res.json({ success: true, data: heroItemsWithTrailers });
    } catch (error) {
        console.error('❌ Trending Error:', error.message);
        res.json({ success: true, data: [] });
    }
});

// Get trailer for a specific movie/TV show
app.get('/api/trailer/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { forceSearch = 'false' } = req.query;
    
    try {
        // First, try to get trailer from TMDB
        const tmdbData = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos'
        });
        
        const videos = tmdbData.videos?.results || [];
        let trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                     videos.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                     videos.find(v => v.site === 'YouTube');
        
        // If no trailer in TMDB or forceSearch is true, try YouTube API
        if ((!trailer || forceSearch === 'true') && YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
            const title = tmdbData.title || tmdbData.name;
            const year = (tmdbData.release_date || tmdbData.first_air_date || '').split('-')[0];
            
            console.log(`🔍 Searching YouTube for ${title} (${year})`);
            
            // Try to find official trailer
            const youtubeTrailer = await searchYouTubeOfficialTrailer(id, title, year, type);
            
            if (youtubeTrailer) {
                return res.json({
                    success: true,
                    data: {
                        ...youtubeTrailer,
                        source: 'youtube-api',
                        tmdbId: id,
                        type: type
                    }
                });
            }
        }
        
        // Return TMDB trailer if found
        if (trailer) {
            return res.json({
                success: true,
                data: {
                    key: trailer.key,
                    name: trailer.name,
                    source: 'tmdb',
                    embedUrl: `https://www.youtube.com/embed/${trailer.key}`,
                    embedUrlNoCookie: `https://www.youtube-nocookie.com/embed/${trailer.key}`,
                    embedUrlAutoplay: `https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`,
                    embedUrlNoCookieAutoplay: `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3`
                }
            });
        }
        
        // No trailer found
        res.json({ success: false, error: 'No trailer found' });
        
    } catch (error) {
        console.error('❌ Trailer Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Search YouTube for videos
app.get('/api/youtube/search', async (req, res) => {
    const { q, maxResults = 10 } = req.query;
    
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
                description: item.snippet.description,
                thumbnail: item.snippet.thumbnails.high?.url || 
                          item.snippet.thumbnails.default?.url,
                channelTitle: item.snippet.channelTitle,
                publishedAt: item.snippet.publishedAt,
                embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`
            }));
            res.json({ success: true, data: { items: videos } });
        } else {
            res.json({ success: true, data: { items: [] } });
        }
    } catch (error) {
        console.error('YouTube search error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get video details
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
                    description: video.snippet.description,
                    thumbnail: video.snippet.thumbnails.high?.url || 
                              video.snippet.thumbnails.default?.url,
                    channelTitle: video.snippet.channelTitle,
                    viewCount: video.statistics?.viewCount || '0',
                    likeCount: video.statistics?.likeCount || '0',
                    duration: video.contentDetails?.duration || '',
                    embedUrl: `https://www.youtube.com/embed/${video.id}`
                }
            });
        } else {
            res.json({ success: false, error: 'Video not found' });
        }
    } catch (error) {
        console.error('Video details error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get related videos
app.get('/api/youtube/related/:videoId', async (req, res) => {
    const { videoId } = req.params;
    
    try {
        const related = await getRelatedVideos(videoId);
        res.json({ success: true, data: { items: related } });
    } catch (error) {
        console.error('Related videos error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get video comments
app.get('/api/youtube/comments/:videoId', async (req, res) => {
    const { videoId } = req.params;
    
    try {
        const comments = await getVideoComments(videoId);
        res.json({ success: true, data: { items: comments } });
    } catch (error) {
        console.error('Comments error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ OTHER TMDB ROUTES ============

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
        res.json({ 
            success: true, 
            data: { results: [], page: 1, total_pages: 0, total_results: 0 }
        });
    }
});

// Get genres
app.get('/api/genres', async (req, res) => {
    const { type = 'movie' } = req.query;
    try {
        const data = await tmdbFetch(`/genre/${type}/list`);
        res.json({ success: true, data });
    } catch (error) {
        res.json({ success: true, data: { genres: [] } });
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

// Get movie/tv show details with YouTube integration
app.get('/api/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { includeTrailer = 'true' } = req.query;
    
    try {
        const data = await tmdbFetch(`/${type}/${id}`, {
            append_to_response: 'videos,images,credits,similar,watch/providers'
        });
        
        // If includeTrailer is true, try to get YouTube trailer
        if (includeTrailer === 'true' && YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
            const title = data.title || data.name;
            const year = (data.release_date || data.first_air_date || '').split('-')[0];
            
            const youtubeTrailer = await searchYouTubeOfficialTrailer(id, title, year, type);
            if (youtubeTrailer) {
                data.youtube_trailer = {
                    ...youtubeTrailer,
                    source: 'youtube-api'
                };
            }
        }
        
        res.json({ success: true, data });
    } catch (error) {
        console.error(`❌ Details Error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Search (with YouTube integration)
app.get('/api/search', async (req, res) => {
    const { query, page = 1, includeYoutube = 'true' } = req.query;
    
    if (!query || query.length < 2) {
        return res.json({ success: true, data: { results: [] } });
    }
    
    try {
        // TMDB search
        const tmdbData = await tmdbFetch('/search/multi', {
            query: query,
            page: parseInt(page)
        });
        
        // YouTube search (if enabled)
        let youtubeResults = [];
        if (includeYoutube === 'true' && YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
            const youtubeData = await youtubeFetch('/search', {
                q: query,
                part: 'snippet',
                maxResults: 5,
                type: 'video',
                videoEmbeddable: 'true'
            });
            
            if (youtubeData && youtubeData.items) {
                youtubeResults = youtubeData.items.map(item => ({
                    id: item.id.videoId,
                    title: item.snippet.title,
                    media_type: 'youtube',
                    poster_path: item.snippet.thumbnails.high?.url || 
                                item.snippet.thumbnails.default?.url,
                    overview: item.snippet.description,
                    release_date: item.snippet.publishedAt,
                    vote_average: 0,
                    youtube: true
                }));
            }
        }
        
        // Combine results
        const results = {
            ...tmdbData,
            results: [...tmdbData.results, ...youtubeResults],
            youtube_results: youtubeResults.length
        };
        
        res.json({ success: true, data: results });
    } catch (error) {
        console.error(`❌ Search Error:`, error.message);
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

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ START SERVER ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YOUFLEX Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
    console.log(`📡 TMDB API: ${TMDB_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🎬 YouTube API: ${YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE' ? '✅ Configured' : '❌ Not configured'}`);
});

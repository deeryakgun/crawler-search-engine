/**
 * Brightwave Crawler Server
 * Express server exposing crawler, status, and search APIs.
 * Port: 3600
 */

const express = require('express');
const path = require('path');
const { startCrawl, getCrawlerStatus, getAllCrawlers } = require('./crawler');
const { search } = require('./search');

const app = express();
const PORT = 3600;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ API ROUTES ============

/**
 * POST /api/crawl
 * Start a new crawler job
 * Body: { url, depth, hitRate?, pagesPerSecond?, queueCapacity? }
 */
app.post('/api/crawl', async (req, res) => {
  try {
    const { url, depth, hitRate, pagesPerSecond, queueCapacity } = req.body;

    if (!url || !depth) {
      return res.status(400).json({
        error: 'Missing required parameters: url and depth'
      });
    }

    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Validate depth
    const depthNum = parseInt(depth);
    if (isNaN(depthNum) || depthNum < 0 || depthNum > 10) {
      return res.status(400).json({ error: 'Depth must be between 0 and 10' });
    }

    const crawlerId = await startCrawl({
      url,
      depth: depthNum,
      hitRate: parseInt(hitRate) || 200,
      pagesPerSecond: parseInt(pagesPerSecond) || 5,
      queueCapacity: parseInt(queueCapacity) || 100
    });

    res.json({
      success: true,
      crawlerId,
      message: 'Crawler started successfully',
      statusUrl: `/status.html?id=${crawlerId}`
    });
  } catch (err) {
    console.error('Error starting crawl:', err);
    res.status(500).json({ error: 'Failed to start crawler: ' + err.message });
  }
});

/**
 * GET /api/crawler/:id
 * Get crawler status by ID (used for long-polling)
 */
app.get('/api/crawler/:id', (req, res) => {
  const crawlerId = req.params.id;
  const status = getCrawlerStatus(crawlerId);

  if (!status) {
    return res.status(404).json({ error: 'Crawler not found' });
  }

  res.json(status);
});

/**
 * GET /api/crawlers
 * List all crawlers ordered by time
 */
app.get('/api/crawlers', (req, res) => {
  const crawlers = getAllCrawlers();
  res.json(crawlers);
});

/**
 * GET /api/search
 * Search for a query
 * Query params: query, sortBy (relevance|frequency), page, limit
 */
app.get('/api/search', (req, res) => {
  const { query, sortBy = 'relevance', page = 1, limit = 20 } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing required parameter: query' });
  }

  const results = search(
    query,
    sortBy,
    parseInt(page) || 1,
    parseInt(limit) || 20
  );

  res.json(results);
});

/**
 * GET /search (alias without /api prefix)
 * Matches assignment requirement: GET http://localhost:3600/search?query=<word>&sortBy=relevance
 */
app.get('/search', (req, res) => {
  const { query, sortBy = 'relevance', page = 1, limit = 20 } = req.query;

  if (!query) {
    return res.sendFile(path.join(__dirname, 'public', 'search.html'));
  }

  const results = search(
    query,
    sortBy,
    parseInt(page) || 1,
    parseInt(limit) || 20
  );

  res.json(results);
});

// ============ PAGE ROUTES ============

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`\n🕷️  Brightwave Crawler Server`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Crawler:  http://localhost:${PORT}/`);
  console.log(`   Search:   http://localhost:${PORT}/search.html`);
  console.log(`\n   API Endpoints:`);
  console.log(`   POST /api/crawl       - Start a new crawl job`);
  console.log(`   GET  /api/crawler/:id - Get crawler status`);
  console.log(`   GET  /api/crawlers    - List all crawlers`);
  console.log(`   GET  /api/search      - Search indexed content\n`);
});

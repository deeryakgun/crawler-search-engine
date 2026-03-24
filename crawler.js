/**
 * Crawler Manager
 * Manages crawler jobs using worker threads.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const CRAWLERS_DIR = path.join(__dirname, 'data', 'crawlers');

// Ensure directories exist
if (!fs.existsSync(CRAWLERS_DIR)) {
  fs.mkdirSync(CRAWLERS_DIR, { recursive: true });
}

// Active workers map
const activeWorkers = new Map();

// Thread counter for generating unique crawler IDs
let threadCounter = 0;

/**
 * Start a new crawler job
 */
function startCrawl({ url, depth, hitRate, pagesPerSecond, queueCapacity }) {
  return new Promise((resolve, reject) => {
    const epochTime = Date.now();
    threadCounter++;

    // Create crawler ID using epoch time and thread counter
    const crawlerId = `${epochTime}_${threadCounter}`;

    const worker = new Worker(path.join(__dirname, 'crawler-worker.js'), {
      workerData: {
        originUrl: url,
        depth: parseInt(depth) || 1,
        hitRate: parseInt(hitRate) || 200,
        pagesPerSecond: parseInt(pagesPerSecond) || 5,
        queueCapacity: parseInt(queueCapacity) || 100,
        crawlerId
      }
    });

    activeWorkers.set(crawlerId, worker);

    worker.on('message', (msg) => {
      if (msg.type === 'done') {
        activeWorkers.delete(crawlerId);
      }
      if (msg.type === 'error') {
        activeWorkers.delete(crawlerId);
      }
    });

    worker.on('error', (err) => {
      console.error(`Worker error for ${crawlerId}:`, err);
      activeWorkers.delete(crawlerId);
    });

    worker.on('exit', (code) => {
      activeWorkers.delete(crawlerId);
    });

    // Return the crawler ID immediately
    resolve(crawlerId);
  });
}

/**
 * Get crawler status by ID
 */
function getCrawlerStatus(crawlerId) {
  const filePath = path.join(CRAWLERS_DIR, `${crawlerId}.data`);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading crawler state for ${crawlerId}:`, err);
  }
  return null;
}

/**
 * Get all crawlers, ordered by creation time (newest first)
 */
function getAllCrawlers() {
  try {
    if (!fs.existsSync(CRAWLERS_DIR)) return [];

    const files = fs.readdirSync(CRAWLERS_DIR)
      .filter(f => f.endsWith('.data'))
      .sort((a, b) => {
        // Extract epoch time from filename
        const timeA = parseInt(a.split('_')[0]);
        const timeB = parseInt(b.split('_')[0]);
        return timeB - timeA; // newest first
      });

    return files.map(f => {
      try {
        const content = fs.readFileSync(path.join(CRAWLERS_DIR, f), 'utf-8');
        const data = JSON.parse(content);
        return {
          crawlerId: data.crawlerId,
          originUrl: data.originUrl,
          depth: data.depth,
          status: data.status,
          pagesVisited: data.pagesVisited,
          queueDepth: data.queueDepth,
          startTime: data.startTime,
          lastUpdated: data.lastUpdated
        };
      } catch (err) {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

module.exports = { startCrawl, getCrawlerStatus, getAllCrawlers };

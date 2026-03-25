/**
 * Crawler Worker Thread
 * Runs in a separate thread to perform web crawling operations.
 * Communicates with the main thread via parentPort messages.
 */

const { parentPort, workerData, threadId } = require('worker_threads');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const CRAWLERS_DIR = path.join(DATA_DIR, 'crawlers');
const VISITED_FILE = path.join(DATA_DIR, 'visited_urls.data');

// Ensure directories exist
[DATA_DIR, STORAGE_DIR, CRAWLERS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Worker data from main thread
const {
  originUrl,
  depth,
  hitRate = 200,         // ms delay between requests
  pagesPerSecond = 5,    // max pages per second
  queueCapacity = 100,   // max queue size before pausing
  crawlerId
} = workerData;

// State
let status = 'running';
let logs = [];
let pagesVisited = 0;
let queueDepth = 0;
let startTime = Date.now();
let urlQueue = [];       // { url, currentDepth }
let visitedUrls = new Set();

/**
 * Log a message and update the crawler state file
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}`;
  logs.push(entry);
  saveState();
  parentPort.postMessage({ type: 'log', message: entry });
}

/**
 * Save crawler state to [crawlerId].data file
 */
function saveState() {
  const state = {
    crawlerId,
    originUrl,
    depth,
    hitRate,
    pagesPerSecond,
    queueCapacity,
    status,
    pagesVisited,
    queueDepth: urlQueue.length,
    startTime,
    lastUpdated: Date.now(),
    logs,
    queue: urlQueue.slice(0, 50) // save first 50 items for visibility
  };
  const filePath = path.join(CRAWLERS_DIR, `${crawlerId}.data`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (err) {
    // Silently fail on write errors during rapid updates
  }
}

/**
 * Load visited URLs from the global visited_urls.data file
 */
function loadVisitedUrls() {
  try {
    if (fs.existsSync(VISITED_FILE)) {
      const content = fs.readFileSync(VISITED_FILE, 'utf-8');
      content.split('\n').filter(Boolean).forEach(u => visitedUrls.add(u.trim()));
    }
  } catch (err) {
    // File doesn't exist yet, start fresh
  }
}

/**
 * Append a URL to the visited_urls.data file
 */
function markVisited(pageUrl) {
  visitedUrls.add(pageUrl);
  try {
    fs.appendFileSync(VISITED_FILE, pageUrl + '\n');
  } catch (err) {
    log(`Warning: Could not write to visited_urls.data: ${err.message}`);
  }
}

/**
 * Fetch a URL using native http/https modules
 * Returns a promise that resolves with { statusCode, body, finalUrl }
 */
function fetchUrl(pageUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    const parsedUrl = new URL(pageUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'WebCrawler/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 15000
    };

    const req = client.request(options, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        }
        return fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }

      let body = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body, finalUrl: pageUrl });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Extract text words and their frequencies from HTML content
 */
function extractWords(html) {
  // Remove script and style tags and their content
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode basic HTML entities
  text = text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&nbsp;/g, ' ');
  // Extract words (letters only, min 2 chars)
  const words = text.toLowerCase().match(/[a-z]{2,}/g) || [];

  const freq = {};
  words.forEach(word => {
    freq[word] = (freq[word] || 0) + 1;
  });
  return freq;
}

/**
 * Extract links from HTML content
 */
function extractLinks(html, baseUrl) {
  const links = new Set();
  // Match href attributes in anchor tags
  const hrefRegex = /<a[^>]+href\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1].trim();

    // Skip non-http links
    if (href.startsWith('mailto:') || href.startsWith('javascript:') ||
        href.startsWith('tel:') || href.startsWith('ftp:') || href.startsWith('data:')) {
      continue;
    }

    try {
      // Resolve relative URLs
      const resolved = new URL(href, baseUrl).href;
      // Only follow http/https links
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        // Remove fragment
        const cleanUrl = resolved.split('#')[0];
        // Remove trailing slash for consistency
        links.add(cleanUrl);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  }

  return Array.from(links);
}

/**
 * Store word frequencies in [letter].data files
 * Format: word url origin depth frequency
 */
function storeWords(wordFreq, pageUrl, origin, currentDepth) {
  // Group words by first letter
  const letterGroups = {};
  for (const [word, frequency] of Object.entries(wordFreq)) {
    const letter = word[0].toLowerCase();
    if (letter >= 'a' && letter <= 'z') {
      if (!letterGroups[letter]) letterGroups[letter] = [];
      letterGroups[letter].push(`${word} ${pageUrl} ${origin} ${currentDepth} ${frequency}`);
    }
  }

  // Append to each letter file
  for (const [letter, lines] of Object.entries(letterGroups)) {
    const filePath = path.join(STORAGE_DIR, `${letter}.data`);
    try {
      fs.appendFileSync(filePath, lines.join('\n') + '\n');
    } catch (err) {
      log(`Warning: Could not write to ${letter}.data: ${err.message}`);
    }
  }
}

/**
 * Rate-limiter: delay between requests
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main crawl function - BFS with depth tracking
 */
async function crawl() {
  log(`Starting crawler ${crawlerId}`);
  log(`Origin: ${originUrl}, Depth: ${depth}`);
  log(`Settings: hitRate=${hitRate}ms, pagesPerSecond=${pagesPerSecond}, queueCapacity=${queueCapacity}`);

  loadVisitedUrls();

  // Initialize queue with origin URL
  urlQueue.push({ url: originUrl, currentDepth: 0 });

  let requestsThisSecond = 0;
  let secondStart = Date.now();

  while (urlQueue.length > 0) {
    // Backpressure: pause if queue is too large
    if (urlQueue.length > queueCapacity) {
      log(`Backpressure: queue size (${urlQueue.length}) exceeds capacity (${queueCapacity}). Pausing...`);
      while (urlQueue.length > queueCapacity * 0.8) {
        // Process items to reduce queue
        const item = urlQueue.shift();
        if (!item) break;

        if (visitedUrls.has(item.url)) continue;
        if (item.currentDepth > depth) continue;

        await processUrl(item.url, item.currentDepth);
        await delay(hitRate);
      }
      log(`Queue reduced to ${urlQueue.length}. Resuming...`);
    }

    const item = urlQueue.shift();
    if (!item) break;

    // Skip already visited
    if (visitedUrls.has(item.url)) continue;

    // Skip if beyond max depth
    if (item.currentDepth > depth) continue;

    // Rate limiting: pages per second
    const now = Date.now();
    if (now - secondStart >= 1000) {
      requestsThisSecond = 0;
      secondStart = now;
    }

    if (requestsThisSecond >= pagesPerSecond) {
      const waitTime = 1000 - (now - secondStart);
      if (waitTime > 0) {
        await delay(waitTime);
      }
      requestsThisSecond = 0;
      secondStart = Date.now();
    }

    await processUrl(item.url, item.currentDepth);
    requestsThisSecond++;

    // Hit rate delay
    await delay(hitRate);

    // Update queue depth for reporting
    queueDepth = urlQueue.length;
  }

  status = 'completed';
  log(`Crawl completed. Total pages visited: ${pagesVisited}`);
  saveState();
  parentPort.postMessage({ type: 'done', pagesVisited });
}

/**
 * Process a single URL: fetch, extract words, extract links
 */
async function processUrl(pageUrl, currentDepth) {
  try {
    markVisited(pageUrl);
    log(`Crawling [depth=${currentDepth}]: ${pageUrl}`);

    const { statusCode, body } = await fetchUrl(pageUrl);

    if (statusCode !== 200) {
      log(`Error: HTTP ${statusCode} for ${pageUrl}`);
      return;
    }

    pagesVisited++;

    // Extract and store words
    const wordFreq = extractWords(body);
    const wordCount = Object.keys(wordFreq).length;
    storeWords(wordFreq, pageUrl, originUrl, currentDepth);
    log(`Indexed ${wordCount} unique words from ${pageUrl}`);

    // Extract links and add to queue if within depth
    if (currentDepth < depth) {
      const links = extractLinks(body, pageUrl);
      let addedLinks = 0;
      for (const link of links) {
        if (!visitedUrls.has(link)) {
          urlQueue.push({ url: link, currentDepth: currentDepth + 1 });
          addedLinks++;
        }
      }
      log(`Found ${links.length} links, queued ${addedLinks} new links [queue size: ${urlQueue.length}]`);
    }

    saveState();
  } catch (err) {
    log(`Error crawling ${pageUrl}: ${err.message}`);
  }
}

// Start crawling
crawl().catch(err => {
  status = 'error';
  log(`Fatal error: ${err.message}`);
  saveState();
  parentPort.postMessage({ type: 'error', error: err.message });
});

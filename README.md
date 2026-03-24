# Brightwave Web Crawler

A web crawler with indexing and search capabilities, built with Node.js. Designed for the Brightwave technical assessment.

## Features

- **Web Crawler (Indexer)**: Crawl any URL to a specified depth with configurable backpressure controls
- **Search Engine**: Full-text search across indexed pages with relevance scoring
- **Real-time Status**: Live log viewer with long-polling to monitor crawl progress
- **Resumable**: Crawl state is persisted to disk — the system can resume after interruption
- **Concurrent Search + Indexing**: Search reflects new results as they are discovered during active crawling

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express.js (minimal dependency)
- **HTTP Client**: Native `http`/`https` modules (no axios/fetch libraries)
- **HTML Parsing**: Regex-based (no cheerio/jsdom)
- **Concurrency**: `worker_threads` for non-blocking crawl jobs
- **Storage**: File-based (no database required)

## Getting Started

### Prerequisites

- Node.js v18+ installed
- npm

### Installation

```bash
git clone https://github.com/<your-username>/hw1.git
cd hw1
npm install
```

### Running

```bash
node server.js
```

The server starts on **http://localhost:3600**

### Pages

| Page | URL | Description |
|------|-----|-------------|
| Crawler | http://localhost:3600 | Create crawl jobs, view history |
| Status | http://localhost:3600/status.html?id=CRAWLER_ID | Live logs and progress |
| Search | http://localhost:3600/search.html | Search indexed content |

## API Endpoints

### POST /api/crawl

Start a new crawl job.

**Request Body:**
```json
{
  "url": "https://books.toscrape.com",
  "depth": 2,
  "hitRate": 200,
  "pagesPerSecond": 5,
  "queueCapacity": 100
}
```

**Response:**
```json
{
  "success": true,
  "crawlerId": "1774371340738_1",
  "statusUrl": "/status.html?id=1774371340738_1"
}
```

### GET /api/crawler/:id

Get crawler status by ID. Returns logs, queue depth, pages visited, and configuration.

### GET /api/crawlers

List all crawlers ordered by creation time (newest first).

### GET /search?query=\<word\>&sortBy=relevance

Search indexed content. Returns a list of triples: `(relevant_url, origin_url, depth)` along with `relevance_score`.

**Parameters:**
- `query` (required) — search terms
- `sortBy` — `relevance` (default) or `frequency`
- `page` — page number (default: 1)
- `limit` — results per page (default: 20)

**Response:**
```json
{
  "results": [
    {
      "url": "https://example.com/page",
      "origin_url": "https://example.com",
      "depth": 1,
      "relevance_score": 2025,
      "frequency": 103,
      "matched_words": ["page"]
    }
  ],
  "total": 174,
  "page": 1,
  "totalPages": 9,
  "query": "page"
}
```

## Architecture

```
hw1/
├── server.js              # Express server, API routes
├── crawler.js             # Crawler manager (worker thread orchestration)
├── crawler-worker.js      # Worker thread (fetch, parse, index)
├── search.js              # Search engine (letter-based file lookup)
├── package.json
├── data/
│   ├── storage/           # Word index: a.data, b.data, ..., z.data
│   ├── crawlers/          # Crawler state files (JSON)
│   └── visited_urls.data  # Global visited URL registry
└── public/
    ├── index.html         # Crawler page
    ├── status.html        # Status page (long-polling)
    ├── search.html        # Search page
    └── style.css          # Light theme CSS
```

### How It Works

1. **Indexing**: When a crawl job is created, a worker thread is spawned. It fetches the origin URL, extracts text (word frequencies) and links. Words are stored in `data/storage/[first-letter].data` files. Links within the depth limit are added to a processing queue.

2. **Backpressure**: Three mechanisms control load:
   - **Hit Rate**: Minimum delay (ms) between requests
   - **Pages/Second**: Maximum requests per second cap
   - **Queue Capacity**: When the URL queue exceeds capacity, the crawler pauses until it's reduced to 80%

3. **Deduplication**: `visited_urls.data` tracks all visited URLs across crawl jobs. URLs are checked before fetching.

4. **Search**: Query words are parsed, and each word's first letter determines which `.data` file to read. Results are scored using: `score = (frequency × 10) + 1000 − (depth × 5)`

5. **Concurrent Access**: Search reads storage files at query time, so it immediately reflects any new data written by active crawlers.

### Relevance Scoring Formula

```
score = (frequency × 10) + 1000 (exact match bonus) − (depth × 5)
```

- Higher frequency → higher score
- Shallower depth → higher score
- Exact word match gets a 1000-point bonus

## Data Format

Each line in `data/storage/[letter].data`:
```
word url origin depth frequency
```

Example from `p.data`:
```
page https://github.com/pricing https://github.com 1 103
price https://books.toscrape.com/catalogue/some-book/index.html https://books.toscrape.com 2 6
```

## Resumability

The system persists all state to disk:
- `visited_urls.data` — prevents re-crawling pages across restarts
- `data/crawlers/[id].data` — preserves crawler logs and progress
- `data/storage/*.data` — indexed word data is never lost

After a restart, previously indexed data is immediately searchable. New crawl jobs will skip already-visited URLs.

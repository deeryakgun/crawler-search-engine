# Product Requirements Document (PRD)

## Project: Web Crawler

### Overview

Build a web crawler system that exposes two capabilities — **index** and **search** — with a web-based UI for managing crawl jobs and searching indexed content. The system runs on a single machine using file-based storage and worker threads for concurrent crawling.

---

### Goals

1. **Index**: Given a URL and depth `k`, crawl web pages up to `k` hops from the origin, indexing word frequencies for search
2. **Search**: Given a query string, return relevant URLs as triples `(relevant_url, origin_url, depth)` with relevance scoring
3. **UI**: Provide a web interface to initiate indexing, perform searches, and view system state (progress, queue depth, backpressure)
4. **Resumability**: System can resume after interruption without starting from scratch

---

### Functional Requirements

#### Crawler (Index)

| Requirement | Description |
|---|---|
| **Origin URL** | Accept any valid HTTP/HTTPS URL as the starting point |
| **Depth (k)** | Crawl up to `k` hops from the origin (0 = origin only, 1 = origin + direct links, etc.) |
| **Deduplication** | Never crawl the same URL twice, tracked via `visited_urls.data` |
| **Word Indexing** | Extract all text words from HTML, store frequencies by first letter in `data/storage/[letter].data` |
| **Link Discovery** | Extract all `<a href>` links from HTML, add to crawl queue if within depth limit |
| **Backpressure** | Three configurable controls: hit rate (ms delay), pages/second cap, queue capacity |
| **Threading** | Each crawl job runs in a separate worker thread to avoid blocking the main event loop |
| **State Persistence** | Crawler state (logs, queue, config) stored in `data/crawlers/[crawlerId].data` |
| **Crawler ID** | Format: `[EpochTimeCreated]_[ThreadCounter]` |

#### Search

| Requirement | Description |
|---|---|
| **Query Parsing** | Split query into individual words (lowercase, alphabetic, min 2 chars) |
| **File Lookup** | Each word's first letter determines which `[letter].data` file to search |
| **Relevance Scoring** | `score = (frequency × 10) + 1000 − (depth × 5)` |
| **Result Format** | Return `(url, origin_url, depth, relevance_score, frequency, matched_words)` |
| **Pagination** | Support `page` and `limit` parameters |
| **Sorting** | Sort by `relevance` (default) or `frequency` |
| **Live Results** | Search reads storage files at query time, reflecting data from active crawlers |

#### UI (3 Pages)

| Page | Description |
|---|---|
| **Crawler** (`/`) | Form to create crawl jobs (URL, depth, backpressure settings). Shows previous jobs with links to status pages |
| **Status** (`/status.html?id=ID`) | Real-time log viewer via long-polling (2s interval). Shows status, pages visited, queue depth, elapsed time, configuration |
| **Search** (`/search.html`) | Search input with sort/limit controls. Displays ranked results with score, origin, depth. Pagination support |

---

### Non-Functional Requirements

| Requirement | Implementation |
|---|---|
| **Language-native** | Use Node.js native `http/https` for fetching, regex for HTML parsing (no cheerio, axios, etc.) |
| **Single machine** | Designed for large-scale crawling on one machine, no distributed system needed |
| **Minimal dependencies** | Only `express` as external dependency |
| **File-based storage** | All data stored in filesystem under `data/` directory |
| **Clean UI** | Light color theme, modern typography, responsive layout |
| **Port** | Server runs on `localhost:3600` |

---

### API Specification

| Method | Endpoint | Parameters | Description |
|---|---|---|---|
| POST | `/api/crawl` | `url`, `depth`, `hitRate?`, `pagesPerSecond?`, `queueCapacity?` | Start a crawl job |
| GET | `/api/crawler/:id` | — | Get crawler status/logs |
| GET | `/api/crawlers` | — | List all crawlers (newest first) |
| GET | `/search` | `query`, `sortBy?`, `page?`, `limit?` | Search indexed content |
| GET | `/api/search` | (same as above) | Alias for search |

---

### Data Storage Schema

#### Word Index (`data/storage/[letter].data`)
```
word url origin depth frequency
```
One entry per line. Each word is stored under its first letter's file.

#### Crawler State (`data/crawlers/[crawlerId].data`)
```json
{
  "crawlerId": "1774371340738_1",
  "originUrl": "https://example.com",
  "depth": 2,
  "status": "running|completed|interrupted|error",
  "pagesVisited": 356,
  "queueDepth": 1200,
  "logs": ["[timestamp] message", ...],
  "queue": [{"url": "...", "currentDepth": 1}, ...]
}
```

#### Visited URLs (`data/visited_urls.data`)
```
https://example.com
https://example.com/page1
https://example.com/page2
```
One URL per line.

---

### Backpressure Design

| Control | Default | Effect |
|---|---|---|
| **Hit Rate** | 200ms | Minimum delay between consecutive HTTP requests |
| **Pages/Second** | 5 | Hard cap on requests per second |
| **Queue Capacity** | 100 | When queue exceeds this, crawler pauses and processes until queue reaches 80% capacity |

These three mechanisms work together to prevent overwhelming the target server and the local machine's resources.

---

### How Search Works During Active Indexing

Since the crawler writes word data to `[letter].data` files via `fs.appendFileSync`, and the search module reads these files via `fs.readFileSync` at query time, search naturally reflects the latest indexed data. There is no cache or in-memory index — every search reads the current state of the filesystem. This means:

- A word indexed 1 second ago will appear in search results
- No synchronization mechanism is needed between the crawler and search
- Multiple crawlers can run simultaneously without conflicts (append-only writes)

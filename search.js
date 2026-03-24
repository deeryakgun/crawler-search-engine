/**
 * Search Module
 * Reads word index files ([letter].data) and returns ranked results.
 * Scoring: score = (frequency × 10) + 1000 (exact match bonus) - (depth × 5)
 */

const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, 'data', 'storage');

/**
 * Search for a query string in the indexed data
 * @param {string} query - The search query
 * @param {string} sortBy - 'relevance' or 'frequency'
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Results per page
 * @returns {Object} { results, total, page, limit, query }
 */
function search(query, sortBy = 'relevance', page = 1, limit = 20) {
  if (!query || query.trim() === '') {
    return { results: [], total: 0, page, limit, query };
  }

  // Parse query into words
  const words = query.toLowerCase().match(/[a-z]{2,}/g) || [];

  if (words.length === 0) {
    return { results: [], total: 0, page, limit, query };
  }

  // Aggregate results across all query words
  // Key: url, Value: { url, origin, depth, scores: [], totalFrequency }
  const resultMap = new Map();

  for (const word of words) {
    const letter = word[0];
    const filePath = path.join(STORAGE_DIR, `${letter}.data`);

    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts.length < 5) continue;

        const [storedWord, url, origin, depthStr, freqStr] = parts;
        const frequency = parseInt(freqStr) || 0;
        const depthVal = parseInt(depthStr) || 0;

        // Check if the stored word matches the query word
        if (storedWord === word) {
          // Exact match scoring
          const score = (frequency * 10) + 1000 - (depthVal * 5);

          const key = `${url}_${origin}_${depthVal}`;
          if (resultMap.has(key)) {
            const existing = resultMap.get(key);
            existing.relevance_score += score;
            existing.frequency += frequency;
            existing.matchedWords.add(word);
          } else {
            resultMap.set(key, {
              url,
              origin_url: origin,
              depth: depthVal,
              relevance_score: score,
              frequency,
              matchedWords: new Set([word])
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error reading ${letter}.data:`, err.message);
    }
  }

  // Convert to array
  let results = Array.from(resultMap.values()).map(r => ({
    url: r.url,
    origin_url: r.origin_url,
    depth: r.depth,
    relevance_score: r.relevance_score,
    frequency: r.frequency,
    matched_words: Array.from(r.matchedWords)
  }));

  // Sort results
  if (sortBy === 'frequency') {
    results.sort((a, b) => b.frequency - a.frequency);
  } else {
    // Default: relevance
    results.sort((a, b) => b.relevance_score - a.relevance_score);
  }

  // Pagination
  const total = results.length;
  const startIdx = (page - 1) * limit;
  const paginatedResults = results.slice(startIdx, startIdx + limit);

  return {
    results: paginatedResults,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    query
  };
}

module.exports = { search };

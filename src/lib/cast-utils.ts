import { FarcasterCast } from './types/zoiner';

/**
 * Check if text contains "coin this cast" pattern - FIXED to be more specific
 */
export function isRequestToCoinCast(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // More specific patterns that won't match general "coin" mentions
  const patterns = [
    'coin this cast',        // Exact phrase
    'coin this post',        // Alternative wording
    'coinify this cast',     // Alternative verb
    'tokenize this cast',    // Alternative verb
    'token this cast',       // Alternative noun
    'make this a coin',      // Natural language variant
    'turn this into a coin', // Natural language variant
    'create coin from this'  // Natural language variant
  ];
  
  // Check if any pattern matches
  const hasPattern = patterns.some(pattern => lowerText.includes(pattern));
  
  // Additional check: if text contains just "coin this" without "cast" or "post", 
  // only match if it's very short (likely intentional)
  if (!hasPattern && lowerText.includes('coin this')) {
    const words = lowerText.trim().split(/\s+/);
    // Only match "coin this" if the entire message is 4 words or less
    // e.g., "coin this" or "zoiner coin this" but not longer sentences
    if (words.length <= 4 && (lowerText.includes('coin this') || lowerText.includes('@zoiner coin this'))) {
      console.log(`📝 Matched short "coin this" command: "${text}"`);
      return true;
    }
  }
  
  if (hasPattern) {
    console.log(`📝 Matched "coin this cast" pattern in: "${text}"`);
  }
  
  return hasPattern;
}

/**
 * Extract cast details for OG image generation
 */
export function extractCastPreviewData(cast: FarcasterCast) {
  return {
    author: cast.author.display_name || cast.author.username,
    username: cast.author.username,
    text: cast.text,
    pfp: cast.author.pfp_url,
    timestamp: cast.timestamp,
    hash: cast.hash
  };
}
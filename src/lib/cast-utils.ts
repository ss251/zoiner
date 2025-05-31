import { FarcasterCast } from './types/zoiner';

/**
 * Check if text contains "coin this cast" pattern
 */
export function isRequestToCoinCast(text: string): boolean {
  const lowerText = text.toLowerCase();
  const patterns = [
    'coin this cast',
    'coin this',
    'coinify this cast', 
    'token this cast',
    'tokenize this cast'
  ];
  
  return patterns.some(pattern => lowerText.includes(pattern));
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
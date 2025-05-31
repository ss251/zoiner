import { Address } from 'viem';
import { FarcasterCast, CoinCreationRequest } from './types/zoiner';

/**
 * Check if a message is requesting to create a coin
 * @param text The text to check
 * @returns True if the text appears to be a coin creation request
 */
export function isCoinCreationRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  console.log(`Checking if text is a coin creation request: "${lowerText}"`);
  
  // Check each pattern individually to help with debugging
  const patterns = [
    { pattern: 'coin this', found: lowerText.includes('coin this') },
    { pattern: 'coin this content', found: lowerText.includes('coin this content') },
    { pattern: 'create a coin', found: lowerText.includes('create a coin') },
    { pattern: 'create coin', found: lowerText.includes('create coin') },
    { pattern: 'create a coin:', found: lowerText.includes('create a coin:') },
    { pattern: 'create coin:', found: lowerText.includes('create coin:') },
    { pattern: 'name: & ticker:', found: lowerText.includes('coin') && 
                                 (lowerText.includes('name:') || lowerText.includes('ticker:')) }
  ];
  
  // Log which patterns matched
  patterns.forEach(p => {
    if (p.found) console.log(`✅ Pattern matched: "${p.pattern}"`);
  });
  
  // Check for various coin creation patterns
  const isRequest = patterns.some(p => p.found);
  console.log(`Final result - Is coin creation request: ${isRequest}`);
  return isRequest;
}

/**
 * Parse coin creation request from the message text
 * @param cast The Farcaster cast containing the request
 * @param imageUrl The image URL to use for the coin
 * @param creatorAddress The Ethereum address of the requester
 * @returns Parsed coin creation request or null if parsing failed
 */
export function parseCoinCreationRequest(
  cast: FarcasterCast, 
  imageUrl: string, 
  creatorAddress: Address
): CoinCreationRequest | null {
  if (!cast.text || !imageUrl || !creatorAddress) {
    console.warn('Missing required parameters for coin creation request');
    return null;
  }

  const text = cast.text.trim();
  
  // Extract name using various possible formats
  let name: string | null = null;
  const nameRegexPatterns = [
    /name:?\s*["']?([^"',;:]+)["']?/i,  // name: Something or name:"Something"
    /create\s+(?:a\s+)?(?:coin|token)\s+(?:called|named)\s+["']([^"']+)["']/i,  // create coin called "Something with spaces"
    /create\s+(?:a\s+)?(?:coin|token)\s+(?:called|named)\s+([^,;:]+)/i,  // create coin called Something without quotes
    /create\s+(?:a\s+)?(?:coin|token):\s+(.+?)(?:$|,|;)/i,  // create coin: Something with spaces
    /coin\s+(?:named|called)\s+["']([^"']+)["']/i,  // coin named "Something with spaces"
    /coin\s+(?:named|called)\s+([^,;:]+)/i  // coin named Something without quotes
  ];
  
  for (const pattern of nameRegexPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      console.log(`Matched pattern: ${pattern}`);
      console.log(`Extracted raw name: "${match[1]}"`);
      name = cleanupName(match[1].trim());
      console.log(`Cleaned name: "${name}"`);
      break;
    }
  }
  
  // Extract ticker using various possible formats
  let symbol: string | null = null;
  const tickerRegexPatterns = [
    /ticker:?\s*["']?([^"',;:]+)["']?/i,  // ticker: ABC or ticker:"ABC"
    /symbol:?\s*["']?([^"',;:]+)["']?/i,  // symbol: ABC
    /\$([A-Z0-9]{1,10})\b/i  // $ABC format
  ];
  
  for (const pattern of tickerRegexPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      symbol = match[1].trim();
      break;
    }
  }
  
  // If name wasn't found but we have a direct request, extract between key phrases
  if (!name) {
    const coinThisMatch = text.match(/coin\s+this(?:\s+content)?:?\s*["']?([^"']+)["']?/i);
    if (coinThisMatch && coinThisMatch[1]) {
      // Use the content after "coin this" if it doesn't contain ticker: or name:
      const content = coinThisMatch[1].trim();
      if (!content.toLowerCase().includes('ticker:') && !content.toLowerCase().includes('name:')) {
        name = content;
      }
    }
  }
  
  // Fall back to username if name not specified
  if (!name) {
    name = cast.author.username || cast.author.display_name || 'Coin';
    console.log(`Using fallback name from author: ${name}`);
  }
  
  // Fall back to a generated ticker if not specified
  if (!symbol) {
    // Use the name as the symbol
    symbol = name;
    console.log(`Using name as symbol: ${symbol}`);
  }
  
  // Sanitize and validate
  name = sanitizeName(name);
  symbol = sanitizeSymbol(symbol);
  
  console.log(`Parsed coin request: name="${name}", symbol="${symbol}" (preserving original case and spaces)`);
  
  return {
    name,
    symbol,
    imageUrl,
    creatorAddress
  };
}

/**
 * Sanitize a coin name
 * @param name The name to sanitize
 * @returns Sanitized name
 */
function sanitizeName(name: string): string {
  // Remove any unsafe characters and trim
  const sanitized = name.replace(/[^\w\s\-\.']/g, '').trim();
  
  // Truncate to 30 characters (Zora's limit)
  return sanitized.substring(0, 30);
}

/**
 * Sanitize a coin symbol
 * @param symbol The symbol to sanitize
 * @returns Sanitized symbol
 */
function sanitizeSymbol(symbol: string): string {
  // Remove only unsafe characters but keep spaces, don't uppercase
  const sanitized = symbol.replace(/[^\w\s\-\.']/g, '').trim();
  
  // No length limit and preserve original case
  return sanitized;
}

/**
 * Clean up a name by removing surrounding quotes and trimming
 * @param name The name to clean up
 * @returns Cleaned up name
 */
function cleanupName(name: string): string {
  // Remove surrounding quotes if present
  const cleaned = name.replace(/^["'](.+)["']$/, '$1').trim();
  return cleaned;
} 
import { FarcasterCast } from './types/zoiner';

/**
 * Service for generating OG images from cast data using Farcaster's built-in endpoint
 */
export class OGImageService {
  /**
   * Generate OG image URL for a cast using Farcaster's endpoint
   */
  static generateCastImageUrl(cast: FarcasterCast): string {
    // Use Farcaster's built-in OG image endpoint
    return `https://client.farcaster.xyz/v2/og-image?castHash=${cast.hash}`;
  }

  /**
   * Test if the OG endpoint is working by fetching an image
   */
  static async testImageGeneration(cast: FarcasterCast): Promise<boolean> {
    try {
      const imageUrl = this.generateCastImageUrl(cast);
      const response = await fetch(imageUrl, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      console.error('OG image test failed:', error);
      return false;
    }
  }

  /**
   * Generate a fallback image URL (can use any cast hash for demo)
   */
  static generateFallbackImageUrl(): string {
    // Use a demo cast hash for fallback
    return `https://client.farcaster.xyz/v2/og-image?castHash=0x2b692d62a2274b64e6886233aa73933b51990cae`;
  }
} 
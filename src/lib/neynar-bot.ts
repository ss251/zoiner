import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { FarcasterCast, FarcasterUser } from './types/zoiner';

export class NeynarBotService {
  private client: NeynarAPIClient;
  private signerUuid: string;
  private botFid: number;
  
  constructor(apiKey: string, signerUuid: string, botFid: number) {
    this.client = new NeynarAPIClient({ apiKey });
    this.signerUuid = signerUuid;
    this.botFid = botFid;
  }
  
  /**
   * Get user details by FID
   * @param fid The Farcaster ID to look up
   * @returns User details or null if not found
   */
  async getUserByFid(fid: number): Promise<FarcasterUser | null> {
    try {
      // Using fetchBulkUsers with a single FID
      const response = await this.client.fetchBulkUsers({ fids: [fid] });
      
      if (!response || !response.users || response.users.length === 0) {
        return null;
      }
      
      const user = response.users[0];
      
      // Map from the response format to our internal format
      return {
        fid: user.fid,
        username: user.username ?? 'unnamed',  // Provide defaults for required string fields
        display_name: user.display_name ?? user.username ?? 'Unnamed User', // Use username as fallback
        pfp_url: user.pfp_url,
        verifications: {
          ethereum: user.verifications?.[0] || undefined,
          solana: undefined // Solana not directly provided
        }
      };
    } catch (error) {
      console.error('Error getting user details:', error);
      return null;
    }
  }
  
  /**
   * Get the full details of a cast by its hash
   * @param hash The hash of the cast to fetch
   * @returns A FarcasterCast object or null if not found
   */
  async getCastByHash(hash: string): Promise<FarcasterCast | null> {
    try {
      console.log(`DEBUG - Fetching cast by hash: ${hash}`);
      
      const response = await this.client.fetchBulkCasts({ casts: [hash] });
      
      if (!response?.result?.casts?.[0]) {
        console.warn(`Failed to fetch cast with hash ${hash}`);
        return null;
      }
      
      const rawCast = response.result.casts[0];
      
      // Only log minimal cast details to avoid excessive logging
      console.log('DEBUG - Received cast:', {
        hash: rawCast.hash,
        author_fid: rawCast.author.fid,
        text_length: rawCast.text.length,
        has_embeds: Boolean(rawCast.embeds?.length),
        embeds_count: rawCast.embeds?.length || 0
      });
      
      // Log image-related fields to help with debugging image extraction
      if (rawCast.embeds?.length) {
        console.log('CAST IMAGE RELATED FIELDS:', {
          embedsData: rawCast.embeds
        });
      }
      
      // Format the cast to our internal format
      const formattedCast = this.formatCast(rawCast);
      console.log('DEBUG - Formatted cast:', {
        hash: formattedCast.hash,
        text: formattedCast.text,
        has_embedded_media: Boolean(formattedCast.embedded_media?.length),
        embedded_media_count: formattedCast.embedded_media?.length || 0,
        has_embeds: Boolean(formattedCast.embeds?.length),
        embeds_count: formattedCast.embeds?.length || 0,
        author_fid: formattedCast.author.fid
      });
      
      return formattedCast;
    } catch (error) {
      console.error(`Error fetching cast ${hash}:`, error);
      return null;
    }
  }
  
  /**
   * Reply to a cast with text
   * @param parentFid Author FID of the parent cast
   * @param parentHash Hash of the parent cast
   * @param text Text content for the reply
   * @returns Hash of the new cast or null if failed
   */
  async replyToCast(parentFid: number, parentHash: string, text: string): Promise<string | null> {
    try {
      // Extract URLs from the text to use in embeds
      const urlMatch = text.match(/(https?:\/\/[^\s]+)/g);
      const urls = urlMatch ? [...new Set(urlMatch)] : []; // Remove duplicates
      
      console.log(`Found URLs to embed: ${urls.join(', ')}`);
      
      // Create embeds array if URLs are found
      const embeds = urls.map(url => ({ url }));
      
      // Using publishCast with URLs as embeds
      const response = await this.client.publishCast({
        text: text,
        parent: parentHash,
        parentAuthorFid: parentFid,
        signerUuid: this.signerUuid,
        embeds: embeds.length > 0 ? embeds : undefined
      });
      
      // Use cast hash from the response if available
      return response.cast?.hash || null;
    } catch (error) {
      console.error('Error replying to cast:', error);
      return null;
    }
  }
  
  /**
   * Check if a cast mentions our bot
   * @param cast The cast to check
   * @returns True if the cast mentions our bot
   */
  castMentionsBot(cast: FarcasterCast): boolean {
    console.log('DEBUG - Checking if cast mentions bot');
    console.log('BOT_FID:', this.botFid);
    console.log('Cast mentions array:', JSON.stringify(cast.mentions || []));
    
    if (cast.mentions && cast.mentions.includes(this.botFid)) {
      console.log('DEBUG - Found bot in mentions array ✅');
      return true;
    }
    
    // Also check text for @botname mentions
    const botName = process.env.BOT_NAME || 'zoiner';
    console.log('BOT_NAME from env:', botName);
    console.log('Cast text:', cast.text);
    
    // Check for username format: @zoiner
    const usernameFormat = `@${botName.toLowerCase()}`;
    console.log('Looking for username format:', usernameFormat);
    
    // Check for FID format: @!1057647 (bot's FID)
    const fidFormat = `@!${this.botFid}`;
    console.log('Looking for FID format:', fidFormat);
    
    if (cast.text) {
      const lowerText = cast.text.toLowerCase();
      
      if (lowerText.includes(usernameFormat)) {
        console.log('DEBUG - Found bot username in text ✅');
        return true;
      }
      
      if (lowerText.includes(fidFormat)) {
        console.log('DEBUG - Found bot FID in text ✅');
        return true;
      }
    }
    
    console.log('DEBUG - Bot not mentioned in this cast ❌');
    return false;
  }
  
  /**
   * Get Ethereum address for a Farcaster user
   * @param fid The Farcaster ID to look up
   * @returns Ethereum address or null if not found
   */
  async getUserEthereumAddress(fid: number): Promise<string | null> {
    const user = await this.getUserByFid(fid);
    return user?.verifications?.ethereum || null;
  }
  
  /**
   * Get Ethereum address for a Farcaster user by username
   * @param username The Farcaster username to look up (without @)
   * @returns Ethereum address or null if not found
   */
  async getUserEthereumAddressByUsername(username: string): Promise<string | null> {
    try {
      console.log(`🔍 Looking up user by username: ${username}`);
      
      // Use the Neynar API to search for users by username
      const response = await this.client.searchUser({ q: username, limit: 10 });
      
      if (!response?.result?.users?.length) {
        console.log(`❌ No users found for username: ${username}`);
        return null;
      }
      
      // Find exact username match (case insensitive)
      const exactMatch = response.result.users.find(
        user => user.username.toLowerCase() === username.toLowerCase()
      );
      
      if (!exactMatch) {
        console.log(`❌ No exact match found for username: ${username}`);
        return null;
      }
      
      console.log(`✅ Found user: ${exactMatch.username} (FID: ${exactMatch.fid})`);
      
      // Get the primary verified address
      const ethAddress = exactMatch.verifications?.[0];
      if (ethAddress) {
        console.log(`✅ Found verified ETH address for @${username}: ${ethAddress}`);
        return ethAddress;
      } else {
        console.log(`❌ No verified ETH address for @${username}`);
        return null;
      }
    } catch (error) {
      console.error(`Error looking up user ${username}:`, error);
      return null;
    }
  }
  
  /**
   * Format a cast from Neynar API format to our internal format
   * @param apiCast The cast from Neynar API
   * @returns Formatted cast for internal use
   */
  private formatCast(apiCast: unknown): FarcasterCast {
    // Type guard to ensure apiCast is an object
    if (!apiCast || typeof apiCast !== 'object') {
      throw new Error('Invalid cast data');
    }
    
    const cast = apiCast as Record<string, unknown>;
    
    // Log the entire raw cast structure to see all available fields
    console.log('COMPLETE RAW CAST DATA:', JSON.stringify(cast, null, 2));
    
    // Log specific fields we're looking for regarding images
    console.log('CAST IMAGE RELATED FIELDS:', JSON.stringify({
      embedsData: cast.embeds,
      embedsMedia: cast.embedsMedia,
      attachments: cast.attachments,
      images: cast.images,
      media: cast.media,
      frames: cast.frames
    }, null, 2));
    
    return {
      hash: String(cast.hash || ''),
      thread_hash: cast.thread_hash ? String(cast.thread_hash) : undefined,
      parent_hash: cast.parent_hash ? String(cast.parent_hash) : undefined,
      author: {
        fid: Number((cast.author as Record<string, unknown>)?.fid || 0),
        username: String((cast.author as Record<string, unknown>)?.username || ''),
        display_name: String((cast.author as Record<string, unknown>)?.display_name || ''),
        pfp_url: (cast.author as Record<string, unknown>)?.pfp_url ? 
          String((cast.author as Record<string, unknown>)?.pfp_url) : undefined,
        profile: (cast.author as Record<string, unknown>)?.profile,
        verifications: (cast.author as Record<string, unknown>)?.verifications as { ethereum?: string; solana?: string } || {}
      },
      text: String(cast.text || ''),
      timestamp: String(cast.timestamp || ''),
      embeds: Array.isArray(cast.embeds) ? (cast.embeds as unknown[]).map((embed: unknown) => {
        const e = embed as Record<string, unknown>;
        return {
          url: e.url ? String(e.url) : undefined,
          title: e.title ? String(e.title) : undefined,
          description: e.description ? String(e.description) : undefined,
          image: e.image ? String(e.image) : undefined,
          mimetype: e.mimetype ? String(e.mimetype) : undefined
        };
      }) : undefined,
      mentions: Array.isArray(cast.mentions) ? (cast.mentions as number[]) : undefined,
      mentions_positions: Array.isArray(cast.mentions_positions) ? (cast.mentions_positions as number[]) : undefined,
      parent_url: cast.parent_url ? String(cast.parent_url) : undefined,
      embedded_media: Array.isArray(cast.embedded_media) ? (cast.embedded_media as unknown[]).map((media: unknown) => {
        const m = media as Record<string, unknown>;
        return {
          url: m.url ? String(m.url) : undefined,
          type: m.type ? String(m.type) : undefined,
          alt_text: m.alt_text ? String(m.alt_text) : undefined
        };
      }) : undefined
    };
  }
}

/**
 * Create a NeynarBotService instance using environment variables
 * @returns NeynarBotService instance or null if env vars are missing
 */
export function createNeynarBotService(): NeynarBotService | null {
  const neynarApiKey = process.env.NEYNAR_API_KEY;
  const signerUuid = process.env.SIGNER_UUID;
  const botFid = process.env.BOT_FID;

  if (!neynarApiKey || !signerUuid || !botFid) {
    console.error('Missing required environment variables for NeynarBotService');
    return null;
  }

  return new NeynarBotService(neynarApiKey, signerUuid, parseInt(botFid));
} 
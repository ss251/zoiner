import { ZoinerAgentService } from './ai-agent';
import { NeynarBotService } from './neynar-bot';
import { ZoraService } from './zora';
import { FarcasterCast } from './types/zoiner';

// Check if we're in dry run mode
const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) {
  console.log('🏜️ RUNNING IN AI DRY RUN MODE - LIMITED FUNCTIONALITY FOR TESTING 🏜️');
}

/**
 * AI-Powered Bot Service for Zoiner (Minimal Version)
 * Uses the simplified AI agent without user profiles
 */
export class AIBotService {
  private agent: ZoinerAgentService;
  private processedCasts: Set<string> = new Set(); // Track processed casts to prevent duplicate processing

  constructor(
    private neynarService: NeynarBotService,
    private zoraService: ZoraService
  ) {
    // Initialize the minimal AI agent
    this.agent = new ZoinerAgentService(neynarService, zoraService);
  }

  /**
   * Process an incoming webhook event for a cast using AI
   * @param castHash The hash of the cast to process
   */
  async processCast(castHash: string): Promise<void> {
    // Skip if we've already processed this cast
    if (this.processedCasts.has(castHash)) {
      console.log(`🔄 Skipping already processed cast: ${castHash}`);
      return;
    }

    // Mark this cast as processed immediately to prevent race conditions
    this.processedCasts.add(castHash);

    console.group(`🎨 AI Bot processing cast: ${castHash}`);
    try {
      // Fetch full cast details
      const cast = await this.neynarService.getCastByHash(castHash);

      if (!cast) {
        console.warn(`❌ Failed to fetch cast with hash ${castHash}`);
        console.groupEnd();
        return;
      }

      // CRITICAL: Skip processing if this cast is from our own bot (prevent infinite loops)
      const botFid = parseInt(process.env.BOT_FID || '0');
      if (cast.author.fid === botFid) {
        console.log(`⏭️ Skipping our own bot's cast (FID: ${cast.author.fid}) to prevent infinite loops`);
        console.groupEnd();
        return;
      }

      // Check if this is a cast that mentions our bot
      if (!this.neynarService.castMentionsBot(cast)) {
        console.log(`⏭️ Cast ${castHash} does not mention our bot, ignoring`);
        console.groupEnd();
        return;
      }

      // Additional safety check: Skip if cast is very recent to our last reply
      // This prevents rapid-fire loops if there are webhook delays
      if (await this.isRecentBotInteraction(cast)) {
        console.log(`⏭️ Skipping cast too close to recent bot activity to prevent loops`);
        console.groupEnd();
        return;
      }

      // Log the cast text for debugging
      console.log(`📝 Cast text: "${cast.text}"`);
      console.log(`👤 From user: ${cast.author.username} (FID: ${cast.author.fid})`);

      // Let the AI agent handle everything
      await this.agent.processInteraction(cast);

      console.log('✅ AI agent processing completed successfully');
    } catch (error) {
      console.error(`❌ Error processing cast ${castHash}:`, error);
      
      // Send a friendly error message as fallback
      try {
        const cast = await this.neynarService.getCastByHash(castHash);
        if (cast && this.neynarService.castMentionsBot(cast) && cast.author.fid !== parseInt(process.env.BOT_FID || '0')) {
          await this.neynarService.replyToCast(
            cast.author.fid,
            cast.hash,
            "sorry, i'm having a creative block right now! 🎨 please try again in a moment - your art deserves to shine onchain ✨"
          );
        }
      } catch (fallbackError) {
        console.error('❌ Fallback error message also failed:', fallbackError);
      }
    }
    console.groupEnd();
  }

  /**
   * Check if this cast is too close to recent bot activity to prevent loops
   * @param cast The cast to check
   * @returns True if we should skip this cast to prevent loops
   */
  private async isRecentBotInteraction(cast: FarcasterCast): Promise<boolean> {
    try {
      // If this is a reply to a cast, check if the parent was from our bot
      if (cast.parent_hash) {
        const parentCast = await this.neynarService.getCastByHash(cast.parent_hash);
        const botFid = parseInt(process.env.BOT_FID || '0');
        
        if (parentCast && parentCast.author.fid === botFid) {
          // Check if this cast was created very soon after the parent (within 10 seconds)
          const parentTime = new Date(parentCast.timestamp).getTime();
          const castTime = new Date(cast.timestamp).getTime();
          const timeDiff = castTime - parentTime;
          
          if (timeDiff < 10000) { // Less than 10 seconds
            console.log(`⚠️ Cast created ${timeDiff}ms after bot reply - potential loop detected`);
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Error checking recent bot interaction:', error);
      return false; // If we can't check, proceed with processing
    }
  }

  /**
   * Basic checks to determine if we should process a cast
   * @param cast The cast to check
   * @returns True if we should process this cast
   */
  private shouldProcess(cast: FarcasterCast): boolean {
    // Basic checks (mentions bot, not from bot itself)
    return this.neynarService.castMentionsBot(cast) && 
           cast.author.fid !== parseInt(process.env.BOT_FID || '0');
  }

  /**
   * Get processing statistics for monitoring
   * @returns Basic stats about processed casts
   */
  getStats(): { processedCasts: number } {
    return {
      processedCasts: this.processedCasts.size
    };
  }

  /**
   * Clear processed casts cache (useful for testing)
   */
  clearCache(): void {
    this.processedCasts.clear();
    console.log('🧹 Cleared processed casts cache');
  }
}
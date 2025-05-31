import { Address } from 'viem';
import { NeynarBotService } from './neynar-bot';
import { ZoraService } from './zora';
import { FarcasterCast } from './types/zoiner';
import { extractImageFromCast } from './image-utils';
import { parseCoinCreationRequest } from './parser-utils';

// Check if we're in dry run mode
const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) {
  console.log('🏜️ RUNNING IN DRY RUN MODE - NO COINS WILL BE CREATED AND NO REPLIES WILL BE SENT 🏜️');
}

export class BotService {
  private neynarService: NeynarBotService;
  private zoraService: ZoraService;
  private processedCasts: Set<string> = new Set(); // Track processed casts to prevent duplicate processing
  
  constructor(neynarService: NeynarBotService, zoraService: ZoraService) {
    this.neynarService = neynarService;
    this.zoraService = zoraService;
  }
  
  /**
   * Process an incoming webhook event for a cast
   * @param castHash The hash of the cast to process
   */
  async processCast(castHash: string): Promise<void> {
    // Skip if we've already processed this cast
    if (this.processedCasts.has(castHash)) {
      console.log(`🔄 Skipping already processed cast: ${castHash}`);
      return;
    }
    
    // Mark this cast as processed
    this.processedCasts.add(castHash);
    
    console.group(`🔄 Processing cast: ${castHash}`);
    try {
      // Fetch full cast details
      const cast = await this.neynarService.getCastByHash(castHash);
      
      if (!cast) {
        console.warn(`❌ Failed to fetch cast with hash ${castHash}`);
        console.groupEnd();
        return;
      }
      
      // Skip processing if this cast is from our own bot
      if (cast.author.fid === parseInt(process.env.BOT_FID || '0')) {
        console.log(`⏭️ Skipping our own bot's cast to prevent loops`);
        console.groupEnd();
        return;
      }
      
      // Check if this is a cast that mentions our bot
      if (!this.neynarService.castMentionsBot(cast)) {
        console.log(`⏭️ Cast ${castHash} does not mention our bot, ignoring`);
        console.groupEnd();
        return;
      }
      
      // Log the cast text for debugging
      console.log(`📝 Cast text: "${cast.text}"`);
      
      // Check if this is a coin creation request
      const isCoinRequest = this.isCoinCreationRequest(cast.text);
      
      if (!isCoinRequest) {
        console.log(`ℹ️ Not a coin creation request, sending usage instructions`);
        
        if (!DRY_RUN) {
          await this.replyWithUsageInstructions(cast);
        } else {
          console.log('🏜️ DRY RUN: Would have sent usage instructions');
        }
        
        console.groupEnd();
        return;
      }
      
      // Process the coin creation request
      await this.processCoinCreationRequest(cast);
    } catch (error) {
      console.error(`❌ Error processing cast ${castHash}:`, error);
    }
    console.groupEnd();
  }
  
  /**
   * Check if text contains a coin creation request
   * @param text The text to check
   * @returns True if the text contains a coin creation request
   */
  private isCoinCreationRequest(text: string): boolean {
    const lowerText = text.toLowerCase();
    console.group('🔍 Checking if text is a coin creation request');
    
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
    console.log(`${isRequest ? '✅' : '❌'} Is coin creation request: ${isRequest}`);
    console.groupEnd();
    return isRequest;
  }
  
  /**
   * Process a coin creation request from a cast
   * @param cast The cast containing the coin creation request
   */
  private async processCoinCreationRequest(cast: FarcasterCast): Promise<void> {
    console.group('🪙 Processing coin creation request');
    try {
      // Extract the image from the cast
      console.group('🖼️ Step 1: Extracting image');
      const imageUrl = await extractImageFromCast(cast);
      console.groupEnd();
      
      // If no image found, ask user to provide one
      if (!imageUrl) {
        console.log(`❌ No image found in cast ${cast.hash}`);
        
        const imageErrorMsg = "Please include an image with your coin creation request. Tag me with an image and include the text: \"coin this content: name: YourCoinName ticker: YCN\"";
        
        if (!DRY_RUN) {
          await this.neynarService.replyToCast(
            cast.author.fid,
            cast.hash,
            imageErrorMsg
          );
        } else {
          console.log(`🏜️ DRY RUN: Would have sent reply: ${imageErrorMsg}`);
        }
        
        console.groupEnd();
        return;
      }
      
      console.log(`✅ Using image URL: ${imageUrl}`);
      
      // Get the creator's Ethereum address
      console.group('🔑 Step 2: Getting creator Ethereum address');
      const creatorAddress = await this.neynarService.getUserEthereumAddress(cast.author.fid);
      console.log(`${creatorAddress ? '✅' : '❌'} Creator address: ${creatorAddress || 'Not found'}`);
      console.groupEnd();
      
      if (!creatorAddress) {
        const addressErrorMsg = "I couldn't find your Ethereum address. Please verify an Ethereum address on your Farcaster profile before creating a coin.";
        
        if (!DRY_RUN) {
          await this.neynarService.replyToCast(
            cast.author.fid,
            cast.hash,
            addressErrorMsg
          );
        } else {
          console.log(`🏜️ DRY RUN: Would have sent reply: ${addressErrorMsg}`);
        }
        
        console.groupEnd();
        return;
      }
      
      // Parse the coin creation request
      console.group('📋 Step 3: Parsing coin creation request');
      const coinRequest = parseCoinCreationRequest(
        cast,
        imageUrl,
        creatorAddress as Address
      );
      
      if (!coinRequest) {
        console.log('❌ Failed to parse coin creation request');
        console.groupEnd();
        
        const parseErrorMsg = "I couldn't parse your coin creation request. Please use the format: coin this content: name: [name] ticker: [ticker]";
        
        if (!DRY_RUN) {
          await this.neynarService.replyToCast(
            cast.author.fid,
            cast.hash,
            parseErrorMsg
          );
        } else {
          console.log(`🏜️ DRY RUN: Would have sent reply: ${parseErrorMsg}`);
        }
        
        console.groupEnd();
        return;
      }
      
      console.log('✅ Coin request successfully parsed:', {
        name: coinRequest.name,
        symbol: coinRequest.symbol,
        imageUrl: coinRequest.imageUrl,
        creatorAddress: `${coinRequest.creatorAddress.substring(0, 6)}...${coinRequest.creatorAddress.substring(38)}`
      });
      console.groupEnd();
      
      // Generate metadata URI for the coin
      console.group('🎭 Step 5: Generating metadata');
      const metadataUri = await this.zoraService.buildMetadataUri(
        coinRequest.name,
        coinRequest.symbol,
        coinRequest.imageUrl
      );
      console.log(`✅ Generated metadata URI: ${metadataUri}`);
      console.groupEnd();
      
      // Create the coin using Zora
      console.group('💰 Step 6: Creating coin on Zora');
      const coinParams = {
        name: coinRequest.name,
        symbol: coinRequest.symbol,
        uri: metadataUri,
        payoutRecipient: coinRequest.creatorAddress,
        initialPurchaseWei: 0n
      };
      
      console.log('📝 Coin creation parameters:', {
        ...coinParams,
        payoutRecipient: `${coinRequest.creatorAddress.substring(0, 6)}...${coinRequest.creatorAddress.substring(38)}`
      });
      
      let result;
      if (!DRY_RUN) {
        result = await this.zoraService.createCoin(coinParams);
        console.log('✅ Coin created successfully:', {
          hash: result.hash,
          address: result.address
        });
      } else {
        console.log('🏜️ DRY RUN: Would have created coin with above parameters');
        result = {
          hash: '0xdryrun0000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
          address: '0xdryrun0000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
          deployment: { status: 'dry-run' }
        };
      }
      console.groupEnd();
      
      // Generate the Zora URL
      console.group('🔗 Step 7: Generating Zora URL and sending success message');
      const zoraUrl = this.zoraService.generateZoraUrl(result.address, coinRequest.creatorAddress);
      console.log(`✅ Generated Zora URL: ${zoraUrl}`);
      
      // Create success message - put URL on its own line for better embedding
      const successMessage = `your creation is zoined!\n\n${zoraUrl}`;
      
      // Send a reply with the result
      if (!DRY_RUN) {
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          successMessage
        );
        console.log('✅ Sent success message');
      } else {
        console.log(`🏜️ DRY RUN: Would have sent success message:`);
        console.log(successMessage);
      }
      console.groupEnd();
      
      console.log('✅ Coin creation process completed successfully');
    } catch (error) {
      console.error('❌ Error processing coin creation request:', error);
      
      // Send a reply with the error
      const errorMessage = `Sorry, there was an error creating your coin: ${(error as Error).message}. Please try again later.`;
      
      if (!DRY_RUN) {
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          errorMessage
        );
      } else {
        console.log(`🏜️ DRY RUN: Would have sent error message: ${errorMessage}`);
      }
    }
    console.groupEnd();
  }
  
  /**
   * Reply with usage instructions when bot is mentioned without proper command
   * @param cast The cast to reply to
   */
  private async replyWithUsageInstructions(cast: FarcasterCast): Promise<void> {
    const instructions = "👋 Hi there! I'm Zoiner, a bot that creates Zora ERC20 coins from images.\n\n" +
      "To create a coin, tag me with an image and include the text: \"coin this content: name: YourCoinName ticker: YCN\"\n\n" +
      "Make sure your profile has a verified Ethereum address, as you'll be set as the payout recipient.";
    
    if (!DRY_RUN) {
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        instructions
      );
    } else {
      console.log(`🏜️ DRY RUN: Would have sent usage instructions: ${instructions}`);
    }
  }
} 
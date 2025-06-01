import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { 
  AgentDecision, 
  ImageAnalysis,
  ClaudeMessage,
  ClaudeResponse,
} from './types/ai-agent';
import { FarcasterCast } from './types/zoiner';
import { NeynarBotService } from './neynar-bot';
import { ZoraService } from './zora';
import { extractImageFromCast } from './image-utils';
import { isRequestToCoinCast } from './cast-utils';
import { OGImageService } from './og-image-service';
import { ZOINER_PLATFORM_ADDRESS } from './constants';

// Simplified user context without profiles
interface UserContext {
  fid: number;
  recent_conversations: Array<{
    user_message: string;
    agent_response: string;
    action_taken: string;
    created_at: string;
  }>;
  creation_count: number; // Count from ai_token_creations table
}

const ZOINER_PERSONALITY_PROMPT = `You are Zoiner, a creative AI that helps artists turn their images into Zora ERC20 tokens on Farcaster.

IMPORTANT: If the user explicitly provides a name (e.g., "create a coin called nature"), you MUST use that exact name. Only suggest creative names when the user hasn't specified one.

PERSONALITY TRAITS:
- Creative catalyst who celebrates all forms of art
- Encouraging and supportive, never judgmental  
- Uses artistic language and visual metaphors
- Catchphrase: "your creation is zoined!" for successful tokens
- Focus on artistic vision over technical details

CAPABILITIES:
- Analyze images to understand artistic elements
- Suggest creative token names based on visual content
- Guide users through token creation process
- Create tokens from cast previews when users say "coin this cast"
- Celebrate successful creations enthusiastically

DECISION FRAMEWORK:
1. If user mentions you with an image: Analyze art and offer to tokenize
2. If user says "coin this cast": Create token using cast preview as image
3. If user requests token creation: Extract name/symbol or suggest based on image
4. If user needs help: Provide encouraging, art-focused guidance
5. If unclear intent: Ask clarifying questions about their creative vision

RESPONSE FORMAT:
Always respond with JSON:
{
  "message": "your encouraging response text",
  "action": "create_token" | "create_cast_token" | "clarify" | "help" | "encourage" | "celebrate",
  "suggested_name": "if action is create_token or create_cast_token",
  "suggested_symbol": "if action is create_token or create_cast_token", 
  "metadata_description": "artistic description for token metadata"
}

Remember: You're helping artists express their creativity onchain. Be enthusiastic, supportive, and focus on the artistic journey!`;

export class ZoinerAgentService {
  private supabase: SupabaseClient;

  constructor(
    private neynarService: NeynarBotService,
    private zoraService: ZoraService
  ) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async processInteraction(cast: FarcasterCast): Promise<void> {
    console.group(`🎨 AI Agent processing interaction from FID ${cast.author.fid}`);
    console.log(`📝 Processing cast text: "${cast.text}"`);
    
    try {
      // Check if this is a "coin this cast" request
      const isCastTokenRequest = isRequestToCoinCast(cast.text);
      console.log(`🔍 Is "coin this cast" request: ${isCastTokenRequest}`);
      
      if (isCastTokenRequest) {
        console.log('📸 Taking "coin this cast" path - creating token from cast preview');
        // Handle "coin this cast" requests
        await this.processCastTokenRequest(cast);
      } else {
        console.log('🎨 Taking regular image token creation path - looking for attached images');
        // Handle regular image token creation (existing flow)
        await this.processRegularTokenRequest(cast);
      }
  
    } catch (error) {
      console.error('❌ Error in AI agent processing:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, i'm having a creative block right now! 🎨 try again in a moment ✨"
      );
    } finally {
      console.groupEnd();
    }
  }

  /**
   * Handle "coin this cast" requests - new functionality
   */
  private async processCastTokenRequest(cast: FarcasterCast): Promise<void> {
    let targetCast = cast;

    // If this is a reply, fetch the parent cast to tokenize
    if (cast.parent_hash) {
      console.log('🔗 This is a reply - fetching parent cast for tokenization');
      try {
        const parentCast = await this.neynarService.getCastByHash(cast.parent_hash);
        if (parentCast) {
          targetCast = parentCast;
          console.log(`📄 Using parent cast from ${parentCast.author.username} for tokenization`);
        }
      } catch (error) {
        console.error('❌ Error fetching parent cast:', error);
      }
    }

    // Generate OG image URL (no Claude analysis needed)
    console.log('🖼️ Generating OG image for cast tokenization');
    const imageUrl = OGImageService.generateCastImageUrl(targetCast);
    console.log(`📸 Generated OG image URL: ${imageUrl}`);

    // Analyze cast content for meaningful token naming
    console.log('🤖 Analyzing cast content for token naming');
    const tokenInfo = await this.analyzeCastForTokenCreation(targetCast);
    console.log(`💡 Generated token: "${tokenInfo.name}" (${tokenInfo.symbol})`);

    // Create token directly
    await this.executeCastTokenCreation(
      {
        action: 'create_cast_token',
        message: 'turning this cast into a token! 🎨→🪙',
        suggested_name: tokenInfo.name,
        suggested_symbol: tokenInfo.symbol,
        metadata_description: tokenInfo.description
      },
      cast,
      imageUrl,
      targetCast
    );
  }

  /**
   * Handle regular image token creation - existing functionality
   */
  private async processRegularTokenRequest(cast: FarcasterCast): Promise<void> {
    // 1. Analyze image if present
    const imageUrl = await extractImageFromCast(cast);
    const imageAnalysis = imageUrl ? await this.analyzeImage(imageUrl) : null;

    // 2. Get minimal user context (just recent conversations)
    const userContext = await this.getUserContext(cast.author.fid);

    // 3. AI decision
    const decision = await this.makeRegularDecision(cast, imageAnalysis, userContext);

    // 4. Execute decision
    if (decision.action === 'create_token') {
      await this.executeTokenCreation(decision, cast, imageAnalysis);
    } else {
      await this.neynarService.replyToCast(cast.author.fid, cast.hash, decision.message);
    }

    // 5. Store conversation
    await this.storeConversation(cast, decision, imageAnalysis);
  }

  private async getUserContext(fid: number): Promise<UserContext> {
    // Get recent conversations (last 5)
    const { data: conversations } = await this.supabase
      .from('conversations')
      .select('user_message, agent_response, action_taken, created_at')
      .eq('fid', fid)
      .order('created_at', { ascending: false })
      .limit(5);

    // Count token creations
    const { count } = await this.supabase
      .from('ai_token_creations')
      .select('*', { count: 'exact', head: true })
      .eq('fid', fid);

    return {
      fid,
      recent_conversations: conversations || [],
      creation_count: count || 0
    };
  }

  private async analyzeImage(imageUrl: string): Promise<ImageAnalysis> {
    // Check cache first
    const { data: cached } = await this.supabase
      .from('image_analyses')
      .select('*')
      .eq('image_url', imageUrl)
      .single();

    if (cached) {
      console.log('✅ Using cached image analysis');
      return cached as ImageAnalysis;
    }

    // Analyze with Claude Vision
    const imageBase64 = await this.downloadImageAsBase64(imageUrl);
    const analysis = await this.callClaude([{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: this.getImageMimeType(imageUrl),
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: `Analyze this image for token creation. Respond with JSON:
          {
            "artistic_style": "describe the art style",
            "color_palette": ["dominant", "colors"],
            "mood": "emotional tone",
            "composition_notes": "visual details",
            "suggested_names": ["Creative", "Names"],
            "suggested_symbols": ["SYM", "BOL"],
            "artistic_elements": ["key", "elements"],
            "visual_description": "detailed description"
          }`
        }
      ]
    }], 'You are an AI art critic helping with token creation.');

    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis);
    } catch {
      parsedAnalysis = {
        artistic_style: 'digital art',
        color_palette: ['vibrant'],
        mood: 'creative',
        composition_notes: 'balanced composition',
        suggested_names: ['Creative Vision'],
        suggested_symbols: ['VISION'],
        artistic_elements: ['digital art'],
        visual_description: 'A creative digital work'
      };
    }

    // Cache analysis
    const { data: inserted } = await this.supabase
      .from('image_analyses')
      .insert({
        image_url: imageUrl,
        analysis_result: analysis,
        ...parsedAnalysis
      })
      .select()
      .single();

    return inserted as ImageAnalysis;
  }

  private async makeRegularDecision(
    cast: FarcasterCast, 
    imageAnalysis: ImageAnalysis | null, 
    userContext: UserContext
  ): Promise<AgentDecision> {
    // Check for explicit name/symbol instructions first
    const explicitName = this.extractExplicitName(cast.text);
    const explicitSymbol = this.extractExplicitSymbol(cast.text);
    
    // Always build context and ask Claude for creative response
    const contextText = this.buildContextText(cast, imageAnalysis, userContext);
    
    try {
      const response = await this.callClaude([{
        role: 'user',
        content: [{ type: 'text', text: contextText }]
      }], ZOINER_PERSONALITY_PROMPT);

      const decision = JSON.parse(response) as AgentDecision;
      
      // If user provided explicit names, override Claude's suggestions but keep the creative message
      if (explicitName && decision.action === 'create_token') {
        decision.suggested_name = explicitName;
        decision.suggested_symbol = explicitSymbol || this.generateSymbolFromName(explicitName);
        console.log(`📝 Using explicit name "${explicitName}" with Claude's creative message: "${decision.message}"`);
      }
      
      return decision;
    } catch {
      // Fallback decision
      const text = cast.text.toLowerCase();
      const hasImage = imageAnalysis !== null;

      if (hasImage && (text.includes('coin') || text.includes('token'))) {
        // If we have explicit names, use them in the fallback too
        return {
          action: 'create_token',
          message: explicitName 
            ? `beautiful ${imageAnalysis?.artistic_style || 'artwork'}! creating your "${explicitName}" token now 🎨→🪙`
            : 'creating your token now! 🎨→🪙',
          suggested_name: explicitName || imageAnalysis?.suggested_names[0] || 'Creative Vision',
          suggested_symbol: explicitSymbol || imageAnalysis?.suggested_symbols[0] || 'CREATE',
          metadata_description: imageAnalysis?.visual_description || 'A creative work'
        };
      }

      return {
        action: hasImage ? 'encourage' : 'help',
        message: hasImage 
          ? 'beautiful work! 🎨 want to turn this into a token?' 
          : 'hi! share an image to create a token 🎨→🪙'
      };
    }
  }
  
  // Also add logging to executeTokenCreation to see if it's being called:
  
  private async executeTokenCreation(
    decision: AgentDecision,
    cast: FarcasterCast,
    imageAnalysis: ImageAnalysis | null
  ): Promise<void> {
    console.log('💰 === EXECUTING TOKEN CREATION ===');
    console.log(`💰 Token name: ${decision.suggested_name}`);
    console.log(`💰 Token symbol: ${decision.suggested_symbol}`);
    
    if (process.env.DRY_RUN === 'true') {
      console.log('🏜️ DRY RUN: Simulating token creation');
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\n🏜️ DRY RUN: Token "${decision.suggested_name}" would be created!`
      );
      return;
    }
  
    try {
      console.log('🔍 Getting creator address...');
      const creatorAddress = await this.neynarService.getUserEthereumAddress(cast.author.fid);
      console.log(`🔍 Creator address: ${creatorAddress || 'NOT FOUND'}`);
      
      console.log('🖼️ Extracting image...');
      const imageUrl = await extractImageFromCast(cast);
      console.log(`🖼️ Image URL: ${imageUrl || 'NOT FOUND'}`);
      
      if (!creatorAddress || !imageUrl) {
        console.log('❌ Missing requirements for token creation');
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          !creatorAddress 
            ? "need a verified ethereum address first!" 
            : "need an image to create your token!"
        );
        return;
      }
  
      console.log('📋 Building metadata URI...');
      const metadataUri = await this.zoraService.buildMetadataUri(
        decision.suggested_name!,
        decision.suggested_symbol!,
        imageUrl
      );
      console.log(`📋 Metadata URI: ${metadataUri}`);
  
      console.log('🚀 Creating coin on Zora...');
      const result = await this.zoraService.createCoin({
        name: decision.suggested_name!,
        symbol: decision.suggested_symbol!,
        uri: metadataUri,
        payoutRecipient: creatorAddress as `0x${string}`,
        platformReferrer: ZOINER_PLATFORM_ADDRESS as `0x${string}`,
        initialPurchaseWei: 0n
      });
      console.log(`🚀 Coin created! Address: ${result.address}`);
  
      const zoraUrl = this.zoraService.generateZoraUrl(result.address, ZOINER_PLATFORM_ADDRESS);
      console.log(`🔗 Zora URL: ${zoraUrl}`);
      
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\nyour creation is zoined! 🎨→🪙\n\n${zoraUrl}`
      );
      console.log('✅ Reply sent with Zora URL');
  
      // Store token creation
      await this.supabase.from('ai_token_creations').insert({
        fid: cast.author.fid,
        token_address: result.address,
        token_name: decision.suggested_name!,
        token_symbol: decision.suggested_symbol!,
        image_url: imageUrl,
        image_analysis_id: imageAnalysis?.id,
        ai_generated_description: decision.metadata_description!,
        user_prompt: cast.text,
        zora_url: zoraUrl,
        transaction_hash: result.hash
      });
      console.log('💾 Token creation stored in database');
  
    } catch (error) {
      console.error('❌ Token creation failed:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, hit a creative block! �� try again ✨"
      );
    }
    
    console.log('💰 === TOKEN CREATION EXECUTION COMPLETE ===');
  }

  private async executeCastTokenCreation(
    decision: AgentDecision,
    cast: FarcasterCast,
    imageUrl: string | null,
    targetCast: FarcasterCast
  ): Promise<void> {
    if (process.env.DRY_RUN === 'true') {
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\n🏜️ DRY RUN: Token "${decision.suggested_name}" would be created from cast by ${targetCast.author.username}!`
      );
      return;
    }

    try {
      const creatorAddress = await this.neynarService.getUserEthereumAddress(cast.author.fid);
      
      if (!creatorAddress || !imageUrl) {
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          !creatorAddress 
            ? "need a verified ethereum address first!" 
            : "need an image to create your token!"
        );
        return;
      }

      // Generate better token name based on target cast content
      const tokenName = decision.suggested_name || `Cast by ${targetCast.author.username}`;
      const tokenSymbol = decision.suggested_symbol || 'CAST';
      const description = decision.metadata_description || `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`;

      const metadataUri = await this.zoraService.buildMetadataUri(
        tokenName,
        tokenSymbol,
        imageUrl
      );

      const result = await this.zoraService.createCoin({
        name: tokenName,
        symbol: tokenSymbol,
        uri: metadataUri,
        payoutRecipient: creatorAddress as `0x${string}`,
        platformReferrer: ZOINER_PLATFORM_ADDRESS as `0x${string}`,
        initialPurchaseWei: 0n
      });

      const zoraUrl = this.zoraService.generateZoraUrl(result.address, ZOINER_PLATFORM_ADDRESS);
      
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\nyour creation is zoined! 🎨→🪙\n\ntokenized cast by @${targetCast.author.username}\n\n${zoraUrl}`
      );

      // Store token creation with target cast info
      await this.supabase.from('ai_token_creations').insert({
        fid: cast.author.fid,
        token_address: result.address,
        token_name: tokenName,
        token_symbol: tokenSymbol,
        image_url: imageUrl,
        image_analysis_id: null,
        ai_generated_description: description,
        user_prompt: cast.text,
        zora_url: zoraUrl,
        transaction_hash: result.hash
      });

    } catch (error) {
      console.error('❌ Token creation failed:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, hit a creative block! 🎨 try again ✨"
      );
    }
  }

  private async storeConversation(
    cast: FarcasterCast,
    decision: AgentDecision,
    imageAnalysis: ImageAnalysis | null
  ): Promise<void> {
    await this.supabase.from('conversations').insert({
      fid: cast.author.fid,
      cast_hash: cast.hash,
      user_message: cast.text,
      agent_response: decision.message,
      image_url: imageAnalysis?.image_url,
      image_analysis_id: imageAnalysis?.id,
      action_taken: decision.action
    });
  }

  // Helper methods (same as before)
  private async callClaude(messages: ClaudeMessage[], systemPrompt: string): Promise<string> {
    console.log('🤖 Making Claude API call...');
    
    try {
      const response = await axios.post<ClaudeResponse>(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          system: systemPrompt,
          messages
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01'
          },
          timeout: 30000, // 30 second timeout
          signal: AbortSignal.timeout(30000) // Additional timeout signal
        }
      );
      
      console.log('✅ Claude API call successful');
      return response.data.content[0].text;
    } catch (error) {
      console.error('❌ Claude API call failed:', error);
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          console.error('❌ Request timed out after 30 seconds');
        } else if (error.response) {
          console.error('❌ API error response:', error.response.status, error.response.data);
        } else if (error.request) {
          console.error('❌ No response received from API');
        }
      }
      
      throw error;
    }
  }

  private async downloadImageAsBase64(imageUrl: string): Promise<string> {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data).toString('base64');
  }

  private getImageMimeType(imageUrl: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const url = imageUrl.toLowerCase();
    if (url.includes('.png')) return 'image/png';
    if (url.includes('.gif')) return 'image/gif';
    if (url.includes('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  private buildContextText(
    cast: FarcasterCast, 
    imageAnalysis: ImageAnalysis | null, 
    userContext: UserContext
  ): string {
    let context = `User message: "${cast.text}"\n`;
    
    // Check if user provided explicit name
    const explicitName = this.extractExplicitName(cast.text);
    if (explicitName) {
      context += `\nIMPORTANT: User explicitly requested name: "${explicitName}" - you MUST use this exact name\n`;
    }
    
    // Check if user provided explicit symbol
    const explicitSymbol = this.extractExplicitSymbol(cast.text);
    if (explicitSymbol) {
      context += `\nIMPORTANT: User explicitly requested symbol: "${explicitSymbol}" - you MUST use this exact symbol\n`;
    }
    
    if (imageAnalysis) {
      context += `\nImage: ${imageAnalysis.artistic_style}, ${imageAnalysis.mood}`;
      if (!explicitName) {
        context += `\nSuggested names: ${imageAnalysis.suggested_names.join(', ')}`;
      }
    }

    context += `\nUser has created ${userContext.creation_count} tokens`;
    
    if (userContext.recent_conversations.length > 0) {
      context += `\nRecent: ${userContext.recent_conversations[0].action_taken}`;
    }

    return context;
  }

  /**
   * Analyze cast content to generate meaningful token name and description
   */
  private async analyzeCastForTokenCreation(targetCast: FarcasterCast): Promise<{
    name: string;
    symbol: string;
    description: string;
  }> {
    console.log('🔍 Starting analyzeCastForTokenCreation...');
    
    // First check if the original cast that's being tokenized has an explicit name
    const explicitName = this.extractExplicitName(targetCast.text);
    const explicitSymbol = this.extractExplicitSymbol(targetCast.text);
    
    if (explicitName) {
      console.log(`✅ Using explicit name from cast: "${explicitName}"`);
      return {
        name: explicitName,
        symbol: explicitSymbol || this.generateSymbolFromName(explicitName),
        description: `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`
      };
    }
    
    try {
      // Clean up problematic Unicode characters that might break API calls
      const cleanText = targetCast.text
        .replace(/￼/g, '') // Remove object replacement characters
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .trim();

      console.log('🧹 Cleaned cast text:', cleanText);

      console.log('📝 Building prompt...');
      const prompt = `analyze this cast and create a token name:

"${cleanText}" by ${targetCast.author.display_name || targetCast.author.username}

make it meaningful but not cringe. capture the vibe.

respond only with:
{
  "name": "token name (2-10 words max)",
  "symbol": "symbol (3-10 letters)", 
  "description": "why this cast matters (1-2 sentences)"
}

examples:
- "gm everyone" → {"name": "GM Energy", "symbol": "GM", "description": "daily dose of good morning vibes"}
- "building something cool" → {"name": "Building Cool", "symbol": "BUILD", "description": "the hustle of creating something new"}
- "coffee time" → {"name": "Coffee Time", "symbol": "BREW", "description": "fuel for the grind"}`;

      console.log('✅ Prompt built successfully');
      console.log('🤖 About to call Claude API...');

      const response = await this.callClaude([{
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      }], 'you create token names from social content. be concise and cool.');

      console.log('🔍 Claude response for cast analysis:', response);

      console.log('📊 Parsing Claude response...');
      const parsed = JSON.parse(response);
      console.log('✅ Successfully parsed Claude response:', parsed);
      
      return {
        name: parsed.name || `${targetCast.author.display_name || targetCast.author.username} Cast`,
        symbol: parsed.symbol || 'CAST',
        description: parsed.description || `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`
      };

    } catch (error) {
      console.error('❌ Error analyzing cast content:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        castText: targetCast.text,
        author: targetCast.author.display_name || targetCast.author.username
      });
      
      // Fallback to basic naming
      console.log('🔄 Using fallback token naming...');
      return {
        name: `${targetCast.author.display_name || targetCast.author.username} Cast`,
        symbol: 'CAST',
        description: `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`
      };
    }
  }

  /**
   * Extract explicit name from user text
   */
  private extractExplicitName(text: string): string | null {
    const patterns = [
      // Original patterns for coin creation
      /coin this content:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /create coin:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /create a coin:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /make a coin:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /coin this:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /tokenize this:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      /mint this:\s*([^,\n\r]+?)(?:\s*,|\s+ticker:|\s*$)/i,
      
      // Patterns with "called" or "named"
      /create (?:a )?coin (?:called|named) ["']?([^"',]+?)["']?(?:\s*,|\s+ticker:|\s*$)/i,
      /coin (?:called|named) ["']?([^"',]+?)["']?(?:\s*,|\s+ticker:|\s*$)/i,
      /token (?:called|named) ["']?([^"',]+?)["']?/i,
      
      // Direct name: pattern
      /name:\s*["']?([^"',]+?)["']?(?:\s*,|\s+ticker:|\s*$)/i,
      
      // Quoted token pattern
      /"([^"]+)" token/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Extract explicit symbol from user text
   */
  private extractExplicitSymbol(text: string): string | null {
    const patterns = [
      /ticker:\s*["']?([^"',\s]+)["']?/i,
      /symbol:\s*["']?([^"',\s]+)["']?/i,
      /\$([A-Z0-9]+)\b/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim().toUpperCase();
      }
    }
    return null;
  }

  /**
   * Generate a symbol from a name
   */
  private generateSymbolFromName(name: string): string {
    // Take first letters of words, or first 3-4 letters if single word
    const words = name.split(/\s+/);
    if (words.length > 1) {
      return words.map(w => w[0]).join('').toUpperCase().slice(0, 10);
    }
    return name.toUpperCase().slice(0, 4);
  }
} 